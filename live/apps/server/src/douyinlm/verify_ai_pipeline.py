from __future__ import annotations

import argparse
import asyncio
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from sqlalchemy import func, select

from douyinlm.domain.schemas import ImportManifestEntry, VideoUnderstandingBundle
from douyinlm.jobs.runner import JobRunner
from douyinlm.providers.ffmpeg import FFmpegAdapter
from douyinlm.repositories.database import Database, run_migrations
from douyinlm.repositories.models import (
    AnalysisRun,
    Category,
    CategoryMembership,
    Job,
    ProviderCall,
    TaxonomyRun,
    Video,
    VideoSegment,
    VideoUnderstanding,
)
from douyinlm.services.analysis_jobs import queue_reanalysis
from douyinlm.services.importer import VideoImporter
from douyinlm.settings import Settings
from douyinlm.workflows.video_pipeline import VideoPipeline

_REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
_TERMINAL_JOB_STATES = {"completed", "failed", "blocked"}


class VerificationFailure(RuntimeError):
    pass


@dataclass(frozen=True)
class VerificationResult:
    data_dir: Path
    video_id: str
    purpose_line: str
    category_names: list[str]
    analysis_versions: int
    provider_calls: int


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="用全新数据库和未见视频验证 douyinLM Gate T1 真实 AI 流水线。"
    )
    parser.add_argument("fixture", type=Path, help="包含讲解音轨的授权短视频路径")
    parser.add_argument("--title", help="可选原标题；默认使用文件名，不影响 AI 主旨与分类")
    parser.add_argument("--author", help="可选作者，仅作为来源元数据")
    parser.add_argument("--source-url", help="可选抖音原链接，仅作为来源元数据")
    parser.add_argument(
        "--permission-scope",
        default="下载、AI 处理、Web 展示与现场演示",
        help="素材许可范围说明",
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        help="可选独立空目录；默认写入 tmp/ai-verification",
    )
    parser.add_argument("--timeout", type=float, default=1200, help="每轮解析等待秒数")
    return parser.parse_args()


def _new_data_dir(configured: Path | None) -> Path:
    if configured is not None:
        target = configured.expanduser().resolve()
        if target.exists() and any(target.iterdir()):
            raise VerificationFailure("--data-dir 必须不存在或为空，防止复用演示缓存。")
        target.mkdir(parents=True, exist_ok=True)
        return target
    root = _REPOSITORY_ROOT / "tmp" / "ai-verification"
    root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    target = root / f"{stamp}-{uuid4().hex[:8]}"
    target.mkdir()
    return target.resolve()


def _preflight(settings: Settings, fixture: Path) -> None:
    if not fixture.is_file():
        raise VerificationFailure(f"未找到验收视频：{fixture}")
    if settings.resolved_ffmpeg_path is None or settings.resolved_ffprobe_path is None:
        raise VerificationFailure("FFmpeg 未就绪，请先运行 scripts\\install-ffmpeg.cmd。")
    if settings.ark_api_key is None:
        raise VerificationFailure("缺少 ARK_API_KEY，请只在本机 .env.local 中配置。")
    if not settings.asr_configured:
        raise VerificationFailure(
            "缺少 VOLC_ASR_API_KEY；旧控制台则需 APP ID 与 Access Token。"
        )
    probe = FFmpegAdapter(settings).probe(fixture)
    if not probe.has_audio:
        raise VerificationFailure("验收视频没有音轨，无法覆盖豆包 ASR；请换一条有讲解的视频。")


async def _wait_for_job(database: Database, job_id: str, timeout: float) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while True:
        with database.session() as session:
            job = session.get(Job, job_id)
            if job is None:
                raise VerificationFailure(f"任务记录丢失：{job_id}")
            status = job.status
            last_error = job.last_error
        if status == "completed":
            return
        if status in _TERMINAL_JOB_STATES:
            raise VerificationFailure(
                f"AI 解析任务 {status}：{last_error or '没有可用错误信息'}；数据已保留供排查。"
            )
        if asyncio.get_running_loop().time() >= deadline:
            raise VerificationFailure(f"等待 AI 解析超过 {timeout:.0f} 秒；数据已保留供排查。")
        await asyncio.sleep(0.5)


def _assert_gate_t1(database: Database, video_id: str, source_hash: str) -> VerificationResult:
    with database.session() as session:
        video = session.get(Video, video_id)
        if video is None or video.status != "ready":
            raise VerificationFailure("视频没有进入 ready 状态。")
        if not video.purpose_line or not video.summary:
            raise VerificationFailure("AI 没有生成一句话主旨或摘要。")
        if video.analysis_version != 2:
            raise VerificationFailure("强制重解析没有生成第二个理解版本。")

        runs = session.scalars(
            select(AnalysisRun)
            .where(AnalysisRun.video_id == video_id)
            .order_by(AnalysisRun.run_number)
        ).all()
        if len(runs) != 2 or any(run.status != "completed" for run in runs):
            raise VerificationFailure("两轮 analysis_run 不完整。")
        if len({run.cache_key for run in runs}) != 2:
            raise VerificationFailure("强制重解析错误复用了旧缓存键。")

        understandings = session.scalars(
            select(VideoUnderstanding)
            .where(VideoUnderstanding.video_id == video_id)
            .order_by(VideoUnderstanding.created_at)
        ).all()
        if len(understandings) != 2:
            raise VerificationFailure("没有生成两个版本化 VideoUnderstandingBundle。")
        for understanding in understandings:
            bundle = VideoUnderstandingBundle.model_validate(understanding.bundle_json)
            if bundle.source_hash != source_hash or bundle.video_id != video_id:
                raise VerificationFailure("理解包没有绑定当前原视频哈希。")

        timed_steps = int(
            session.scalar(
                select(func.count())
                .select_from(VideoSegment)
                .where(
                    VideoSegment.video_id == video_id,
                    VideoSegment.kind.in_(["tutorial_step", "claim"]),
                    VideoSegment.end_ms > VideoSegment.start_ms,
                )
            )
            or 0
        )
        if timed_steps < 2:
            raise VerificationFailure("两轮解析没有留下足够的教程/主张视频时间点。")

        taxonomy_runs = session.scalars(
            select(TaxonomyRun).where(TaxonomyRun.status == "completed")
        ).all()
        if len(taxonomy_runs) != 2:
            raise VerificationFailure("两轮解析没有各自产生 AI 分类版本。")
        latest_taxonomy = max(taxonomy_runs, key=lambda item: item.created_at)
        categories = session.scalars(
            select(Category).where(Category.taxonomy_run_id == latest_taxonomy.id)
        ).all()
        memberships = int(
            session.scalar(
                select(func.count())
                .select_from(CategoryMembership)
                .join(Category, Category.id == CategoryMembership.category_id)
                .where(
                    Category.taxonomy_run_id == latest_taxonomy.id,
                    CategoryMembership.video_id == video_id,
                )
            )
            or 0
        )
        if len(categories) < 2 or memberships < 1:
            raise VerificationFailure("AI 没有生成大类、小类及视频归属。")

        run_ids = [run.id for run in runs]
        calls = session.scalars(
            select(ProviderCall).where(ProviderCall.analysis_run_id.in_(run_ids))
        ).all()
        operations = [(call.provider, call.operation) for call in calls]
        for required in (
            ("doubao_asr", "recognize"),
            ("ark", "understand_video"),
            ("ark", "classify"),
        ):
            if operations.count(required) != 2:
                raise VerificationFailure(f"真实 Provider 调用记录不完整：{required}")
        if any(
            call.status != "completed"
            or len(call.request_hash) != 64
            or not call.response_hash
            or len(call.response_hash) != 64
            for call in calls
        ):
            raise VerificationFailure("Provider 调用缺少完成状态或请求/响应哈希。")

        return VerificationResult(
            data_dir=Path(database.engine.url.database or "").parent,
            video_id=video.id,
            purpose_line=video.purpose_line,
            category_names=[item.name for item in categories],
            analysis_versions=video.analysis_version,
            provider_calls=len(calls),
        )


async def _verify(args: argparse.Namespace) -> VerificationResult:
    fixture = args.fixture.expanduser().resolve()
    data_dir = _new_data_dir(args.data_dir)
    settings = Settings(app_mode="test", data_dir=data_dir)
    _preflight(settings, fixture)
    settings.ensure_runtime_directories()
    run_migrations(settings.database_url)
    database = Database(settings.database_url)
    pipeline = VideoPipeline(database, settings)
    runner = JobRunner(database, {"analyze_video": pipeline.handle_job})
    importer = VideoImporter(database, settings, runner.notify)
    source_hash = FFmpegAdapter.file_hash(fixture)
    await runner.start()
    try:
        print("[1/3] 全新数据库已创建，开始首轮真实解析。", flush=True)
        imported = importer.import_path(
            fixture,
            entry=ImportManifestEntry(
                filename=fixture.name,
                title=args.title,
                author=args.author,
                source_url=args.source_url,
            ),
            permission_scope=args.permission_scope,
        )
        if imported.duplicate or imported.job_id is None:
            raise VerificationFailure("全新数据库不应命中旧视频或缺少后台任务。")
        await _wait_for_job(database, imported.job_id, args.timeout)

        print("[2/3] 首轮完成，强制生成第二个版本。", flush=True)
        second_job_id = queue_reanalysis(database, imported.video_id)
        if second_job_id is None:
            raise VerificationFailure("无法创建强制重解析任务。")
        runner.notify()
        await _wait_for_job(database, second_job_id, args.timeout)

        print("[3/3] 校验理解包、时间点、自动分类与 Provider 元数据。", flush=True)
        return _assert_gate_t1(database, imported.video_id, source_hash)
    finally:
        await runner.stop()
        database.close()


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    args = _parse_args()
    try:
        result = asyncio.run(_verify(args))
    except VerificationFailure as exc:
        print(f"[FAIL] Gate T1：{exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"[FAIL] Gate T1 出现未预期错误：{type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    print("[PASS] Gate T1 真实 AI 流水线通过。")
    print(f"一句话主旨：{result.purpose_line}")
    print(f"AI 分类：{' / '.join(result.category_names)}")
    print(f"解析版本：{result.analysis_versions}；真实调用记录：{result.provider_calls}")
    print(f"独立验收数据：{result.data_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
