from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypeVar

from sqlalchemy import func, select

from douyinlm.domain.schemas import TaxonomyDraft, VideoUnderstandingBundle
from douyinlm.providers.ark import ArkAdapter
from douyinlm.providers.asr import DoubaoASRAdapter
from douyinlm.providers.base import (
    DerivedMedia,
    TaxonomyResult,
    TranscriptResult,
    UnderstandingResult,
)
from douyinlm.providers.errors import PipelineError, ProviderNotConfigured
from douyinlm.providers.ffmpeg import FFmpegAdapter
from douyinlm.repositories.database import Database
from douyinlm.repositories.jobs import append_job_event
from douyinlm.repositories.models import (
    AnalysisRun,
    Category,
    CategoryMembership,
    ProviderCall,
    TaxonomyRun,
    Video,
    VideoAsset,
    VideoSegment,
    VideoUnderstanding,
    utc_now,
)
from douyinlm.settings import Settings

T = TypeVar("T")


@dataclass(frozen=True)
class _VideoInput:
    id: str
    title: str
    author: str | None
    source_url: str | None
    source_hash: str
    original_path: Path


class VideoPipeline:
    def __init__(
        self,
        database: Database,
        settings: Settings,
        *,
        media: FFmpegAdapter | None = None,
        asr: DoubaoASRAdapter | None = None,
        ark: ArkAdapter | None = None,
    ) -> None:
        self._database = database
        self._settings = settings
        self._media = media or FFmpegAdapter(settings)
        self._asr = asr or DoubaoASRAdapter(settings)
        self._ark = ark or ArkAdapter(settings)

    def handle_job(self, job_id: str, payload: dict[str, Any]) -> None:
        video_id = str(payload.get("video_id", ""))
        force = bool(payload.get("force", False))
        if not video_id:
            raise PipelineError("invalid_job_payload", "解析任务缺少 video_id。")
        run_id: str | None = None
        try:
            video = self._load_video(video_id)
            run = self._start_run(video, force=force)
            run_id = run.id
            self._event(job_id, "validating", 8, "正在校验视频容器与许可记录。")
            derived = self._media.derive(video.original_path, video.source_hash)
            self._persist_media(video.id, derived)
            self._update_video(
                video.id,
                status="transcribing",
                duration_ms=derived.probe.duration_ms,
            )

            transcript = self._transcribe(job_id, run.id, derived)
            self._persist_transcript(video.id, run.id, transcript)

            self._event(job_id, "understanding", 58, "AI 正在理解画面、字幕与可行动信息。")
            try:
                understanding = self._retry(
                    lambda: self._ark.understand_video(
                        keyframe_paths=derived.keyframe_paths,
                        transcript=transcript,
                        duration_ms=derived.probe.duration_ms,
                        title=video.title,
                        author=video.author,
                        source_url=video.source_url,
                        source_hash=video.source_hash,
                    ),
                    job_id=job_id,
                    stage="understanding",
                )
            except PipelineError as exc:
                self._record_provider_failure(
                    run.id,
                    "ark",
                    "understand_video",
                    _stable_hash(
                        {
                            "source_hash": video.source_hash,
                            "prompt_version": self._settings.understanding_prompt_version,
                            "model": self._settings.ark_model,
                        }
                    ),
                    exc,
                )
                raise
            self._record_provider_success(run.id, "ark", "understand_video", understanding)
            self._validate_times(understanding, derived.probe.duration_ms)
            bundle = VideoUnderstandingBundle(
                **understanding.draft.model_dump(),
                video_id=video.id,
                source_hash=video.source_hash,
                title=video.title,
                author=video.author,
                source_url=video.source_url,
                model_run_id=run.id,
                schema_version=self._settings.understanding_schema_version,
            )
            self._persist_understanding(run.id, bundle, understanding.response_id)

            self._event(job_id, "classifying", 82, "AI 正在重建收藏夹大类与场景小类。")
            taxonomy = self._classify(job_id, run.id)
            self._persist_taxonomy(taxonomy)
            self._complete_run(run.id)
            self._update_video(video.id, status="ready", clear_error=True)
            self._event(job_id, "ready", 100, "理解与自动分类已完成。")
        except PipelineError as exc:
            self._mark_failed(video_id, run_id, exc)
            raise
        except Exception as exc:
            failure = PipelineError(
                "pipeline_unexpected_error",
                f"解析流水线出现未预期错误（{type(exc).__name__}）。",
            )
            self._mark_failed(video_id, run_id, failure)
            raise failure from exc

    def _load_video(self, video_id: str) -> _VideoInput:
        with self._database.session() as session:
            video = session.get(Video, video_id)
            if video is None or not video.source_hash:
                raise PipelineError("video_not_found", "待解析视频不存在。")
            original = session.scalar(
                select(VideoAsset).where(
                    VideoAsset.video_id == video_id,
                    VideoAsset.kind == "original",
                )
            )
            if original is None:
                raise PipelineError("original_missing", "原视频资产记录不存在。")
            original_path = (self._settings.resolved_data_dir / original.relative_path).resolve()
            if not original_path.is_relative_to(self._settings.resolved_data_dir):
                raise PipelineError("unsafe_asset_path", "原视频路径未通过安全校验。")
            if not original_path.is_file():
                raise PipelineError("original_missing", "原视频文件不存在。")
            return _VideoInput(
                id=video.id,
                title=video.title,
                author=video.author,
                source_url=video.source_url,
                source_hash=video.source_hash,
                original_path=original_path,
            )

    def _start_run(self, video: _VideoInput, *, force: bool) -> AnalysisRun:
        cache_key = _stable_hash(
            {
                "source_hash": video.source_hash,
                "pipeline_version": self._settings.pipeline_version,
                "prompt_version": self._settings.understanding_prompt_version,
                "schema_version": self._settings.understanding_schema_version,
                "provider": "ark",
                "model": self._settings.ark_model,
                "force_nonce": utc_now().isoformat() if force else None,
            }
        )
        with self._database.session() as session:
            run_number = int(
                session.scalar(
                    select(func.coalesce(func.max(AnalysisRun.run_number), 0)).where(
                        AnalysisRun.video_id == video.id
                    )
                )
                or 0
            ) + 1
            run = AnalysisRun(
                video_id=video.id,
                run_number=run_number,
                pipeline_version=self._settings.pipeline_version,
                schema_version=self._settings.understanding_schema_version,
                prompt_version=self._settings.understanding_prompt_version,
                model_id=self._settings.ark_model,
                status="running",
                cache_key=cache_key,
            )
            session.add(run)
            target = session.get(Video, video.id)
            if target is not None:
                target.status = "processing"
                target.error_code = None
                target.error_message = None
            session.commit()
            session.refresh(run)
            return run

    def _persist_media(self, video_id: str, derived: DerivedMedia) -> None:
        assets: list[tuple[str, Path, str, int | None, dict[str, Any]]] = [
            (
                "proxy",
                derived.proxy_path,
                "video/mp4",
                derived.probe.duration_ms,
                {"width": derived.probe.width, "height": derived.probe.height},
            )
        ]
        if derived.audio_path is not None:
            assets.append(
                ("audio", derived.audio_path, "audio/mpeg", derived.probe.duration_ms, {})
            )
        count = len(derived.keyframe_paths)
        for index, path in enumerate(derived.keyframe_paths):
            timestamp_ms = round(index * derived.probe.duration_ms / max(1, count))
            assets.append(("keyframe", path, "image/jpeg", None, {"timestamp_ms": timestamp_ms}))

        with self._database.session() as session:
            for kind, path, mime_type, duration_ms, metadata in assets:
                relative = path.resolve().relative_to(self._settings.resolved_data_dir).as_posix()
                existing = session.scalar(
                    select(VideoAsset).where(
                        VideoAsset.video_id == video_id,
                        VideoAsset.kind == kind,
                        VideoAsset.relative_path == relative,
                    )
                )
                if existing is None:
                    session.add(
                        VideoAsset(
                            video_id=video_id,
                            kind=kind,
                            relative_path=relative,
                            sha256=FFmpegAdapter.file_hash(path),
                            mime_type=mime_type,
                            size_bytes=path.stat().st_size,
                            duration_ms=duration_ms,
                            metadata_json=metadata,
                        )
                    )
            session.commit()

    def _transcribe(
        self,
        job_id: str,
        run_id: str,
        derived: DerivedMedia,
    ) -> TranscriptResult:
        if derived.audio_path is None:
            self._event(job_id, "transcribing", 42, "视频没有音轨，将仅依据画面理解。")
            empty_hash = hashlib.sha256(b"").hexdigest()
            return TranscriptResult(
                text="",
                utterances=[],
                request_hash=empty_hash,
                response_hash=empty_hash,
                response_id=None,
                duration_ms=0,
            )
        self._event(job_id, "transcribing", 35, "正在生成带时间点的语音转写。")
        try:
            result = self._retry(
                lambda: self._asr.recognize(derived.audio_path),
                job_id=job_id,
                stage="transcribing",
            )
        except PipelineError as exc:
            self._record_provider_failure(
                run_id,
                "doubao_asr",
                "recognize",
                _stable_hash({"audio": str(derived.audio_path)}),
                exc,
            )
            raise
        self._record_provider_success(run_id, "doubao_asr", "recognize", result)
        return result

    def _persist_transcript(
        self,
        video_id: str,
        run_id: str,
        transcript: TranscriptResult,
    ) -> None:
        with self._database.session() as session:
            for utterance in transcript.utterances:
                session.add(
                    VideoSegment(
                        video_id=video_id,
                        analysis_run_id=run_id,
                        kind="transcript",
                        start_ms=utterance.start_ms,
                        end_ms=utterance.end_ms,
                        text=utterance.text,
                        confidence=utterance.confidence,
                    )
                )
            session.commit()

    def _persist_understanding(
        self,
        run_id: str,
        bundle: VideoUnderstandingBundle,
        response_id: str | None,
    ) -> None:
        with self._database.session() as session:
            session.add(
                VideoUnderstanding(
                    video_id=bundle.video_id,
                    analysis_run_id=run_id,
                    schema_version=bundle.schema_version,
                    purpose_line=bundle.purpose_line,
                    summary=bundle.summary,
                    bundle_json=bundle.model_dump(mode="json"),
                )
            )
            run = session.get(AnalysisRun, run_id)
            if run is not None:
                run.status = "understood"
                run.provider_response_id = response_id
            video = session.get(Video, bundle.video_id)
            if video is not None:
                video.purpose_line = bundle.purpose_line
                video.summary = bundle.summary
                video.analysis_version += 1
                video.status = "classifying"
            for step in bundle.tutorial_steps:
                session.add(
                    VideoSegment(
                        video_id=bundle.video_id,
                        analysis_run_id=run_id,
                        kind="tutorial_step",
                        start_ms=step.start_ms,
                        end_ms=step.end_ms,
                        text=step.text,
                        confidence=step.confidence,
                        metadata_json={"detail": step.detail} if step.detail else {},
                    )
                )
            for claim in bundle.claims:
                session.add(
                    VideoSegment(
                        video_id=bundle.video_id,
                        analysis_run_id=run_id,
                        kind="claim",
                        start_ms=claim.start_ms,
                        end_ms=claim.end_ms,
                        text=claim.text,
                        confidence=claim.confidence,
                        metadata_json={"evidence": claim.evidence},
                    )
                )
            session.commit()

    def _complete_run(self, run_id: str) -> None:
        with self._database.session() as session:
            run = session.get(AnalysisRun, run_id)
            if run is not None:
                run.status = "completed"
                run.completed_at = utc_now()
            session.commit()

    def _classify(self, job_id: str, run_id: str) -> TaxonomyResult:
        with self._database.session() as session:
            latest_ids = (
                select(
                    VideoUnderstanding.video_id,
                    func.max(VideoUnderstanding.created_at).label("latest"),
                )
                .group_by(VideoUnderstanding.video_id)
                .subquery()
            )
            rows = session.scalars(
                select(VideoUnderstanding).join(
                    latest_ids,
                    (VideoUnderstanding.video_id == latest_ids.c.video_id)
                    & (VideoUnderstanding.created_at == latest_ids.c.latest),
                )
            ).all()
            bundles = [VideoUnderstandingBundle.model_validate(row.bundle_json) for row in rows]
        if not bundles:
            raise PipelineError("taxonomy_empty", "没有可供自动分类的理解包。")
        try:
            result = self._retry(
                lambda: self._ark.classify(bundles),
                job_id=job_id,
                stage="classifying",
            )
        except PipelineError as exc:
            self._record_provider_failure(
                run_id,
                "ark",
                "classify",
                _stable_hash([bundle.model_dump(mode="json") for bundle in bundles]),
                exc,
            )
            raise
        self._validate_taxonomy(result.draft, {bundle.video_id for bundle in bundles})
        self._record_provider_success(run_id, "ark", "classify", result)
        return result

    def _persist_taxonomy(self, result: TaxonomyResult) -> None:
        taxonomy_run = TaxonomyRun(
            model_id=self._settings.ark_model,
            status="completed",
            input_hash=result.request_hash,
            provider_response_id=result.response_id,
            completed_at=utc_now(),
        )
        with self._database.session() as session:
            session.add(taxonomy_run)
            session.flush()
            subcategory_ids: dict[str, str] = {}
            for major_index, major in enumerate(result.draft.major_categories):
                major_row = Category(
                    taxonomy_run_id=taxonomy_run.id,
                    key=major.key,
                    level=1,
                    name=major.name,
                    purpose=major.purpose,
                    sort_order=major_index,
                )
                session.add(major_row)
                session.flush()
                for sub_index, subcategory in enumerate(major.subcategories):
                    sub_row = Category(
                        parent_id=major_row.id,
                        taxonomy_run_id=taxonomy_run.id,
                        key=subcategory.key,
                        level=2,
                        name=subcategory.name,
                        purpose=subcategory.purpose,
                        sort_order=sub_index,
                    )
                    session.add(sub_row)
                    session.flush()
                    subcategory_ids[subcategory.key] = sub_row.id
            for membership in result.draft.memberships:
                session.add(
                    CategoryMembership(
                        category_id=subcategory_ids[membership.subcategory_key],
                        video_id=membership.video_id,
                        reason=membership.reason,
                        confidence=membership.confidence,
                    )
                )
            session.commit()

    def _record_provider_success(
        self,
        run_id: str,
        provider: str,
        operation: str,
        result: TranscriptResult | UnderstandingResult | TaxonomyResult,
    ) -> None:
        with self._database.session() as session:
            session.add(
                ProviderCall(
                    analysis_run_id=run_id,
                    provider=provider,
                    operation=operation,
                    model_id=self._provider_model_id(provider),
                    status="completed",
                    request_hash=result.request_hash,
                    response_hash=result.response_hash,
                    response_id=result.response_id,
                    duration_ms=result.duration_ms,
                )
            )
            session.commit()

    def _record_provider_failure(
        self,
        run_id: str,
        provider: str,
        operation: str,
        request_hash: str,
        error: PipelineError,
    ) -> None:
        with self._database.session() as session:
            session.add(
                ProviderCall(
                    analysis_run_id=run_id,
                    provider=provider,
                    operation=operation,
                    model_id=self._provider_model_id(provider),
                    status="failed",
                    request_hash=request_hash,
                    duration_ms=0,
                    error_code=error.code,
                    error_message=error.message,
                )
            )
            session.commit()

    def _mark_failed(self, video_id: str, run_id: str | None, error: PipelineError) -> None:
        with self._database.session() as session:
            video = session.get(Video, video_id)
            if video is not None:
                video.status = (
                    "needs_configuration"
                    if isinstance(error, ProviderNotConfigured)
                    else "failed"
                )
                video.error_code = error.code
                video.error_message = error.message
            if run_id:
                run = session.get(AnalysisRun, run_id)
                if run is not None and run.status != "completed":
                    run.status = "failed"
                    run.error_code = error.code
                    run.error_message = error.message
                    run.completed_at = utc_now()
            session.commit()

    def _update_video(
        self,
        video_id: str,
        *,
        status: str,
        duration_ms: int | None = None,
        clear_error: bool = False,
    ) -> None:
        with self._database.session() as session:
            video = session.get(Video, video_id)
            if video is None:
                return
            video.status = status
            if duration_ms is not None:
                video.duration_ms = duration_ms
            if clear_error:
                video.error_code = None
                video.error_message = None
            session.commit()

    @staticmethod
    def _validate_times(result: UnderstandingResult, duration_ms: int) -> None:
        tolerance = duration_ms + 2000
        timed_items = [
            *result.draft.tutorial_steps,
            *result.draft.claims,
            *result.draft.visible_text,
        ]
        if any(item.end_ms > tolerance for item in timed_items):
            raise PipelineError(
                "evidence_out_of_range",
                "AI 返回了超出视频时长的证据时间点。",
            )

    @staticmethod
    def _validate_taxonomy(draft: TaxonomyDraft, expected_video_ids: set[str]) -> None:
        category_keys: set[str] = set()
        subcategory_keys: set[str] = set()
        listed_video_ids: set[str] = set()
        for major in draft.major_categories:
            if major.key in category_keys:
                raise PipelineError("taxonomy_duplicate_key", "自动分类包含重复 key。")
            category_keys.add(major.key)
            for subcategory in major.subcategories:
                if subcategory.key in category_keys:
                    raise PipelineError("taxonomy_duplicate_key", "自动分类包含重复 key。")
                category_keys.add(subcategory.key)
                subcategory_keys.add(subcategory.key)
                listed_video_ids.update(subcategory.video_ids)
        membership_video_ids = {item.video_id for item in draft.memberships}
        if not expected_video_ids.issubset(listed_video_ids & membership_video_ids):
            raise PipelineError("taxonomy_incomplete", "自动分类没有覆盖全部已理解视频。")
        if (listed_video_ids | membership_video_ids) - expected_video_ids:
            raise PipelineError("taxonomy_unknown_video", "自动分类引用了不存在的视频。")
        if any(item.subcategory_key not in subcategory_keys for item in draft.memberships):
            raise PipelineError("taxonomy_unknown_category", "自动分类引用了不存在的小类。")

    def _retry(
        self,
        operation: Callable[[], T],
        *,
        job_id: str,
        stage: str,
    ) -> T:
        for attempt in range(3):
            try:
                return operation()
            except PipelineError as exc:
                if not exc.retryable or attempt == 2:
                    raise
                wait_seconds = 2**attempt
                progress = {
                    "transcribing": 35,
                    "understanding": 58,
                    "classifying": 82,
                }.get(stage, 0)
                retry_reason = (
                    "模型返回格式未通过校验"
                    if exc.code.startswith("ark_invalid_")
                    else "外部服务暂时不可用"
                )
                self._event(
                    job_id,
                    stage,
                    progress,
                    f"{retry_reason}，{wait_seconds} 秒后自动重试。",
                )
                time.sleep(wait_seconds)
        raise AssertionError("unreachable")

    def _event(self, job_id: str, stage: str, progress: int, message: str) -> None:
        append_job_event(
            self._database,
            job_id,
            stage=stage,
            progress=progress,
            message=message,
        )

    def _provider_model_id(self, provider: str) -> str:
        if provider == "ark":
            return self._settings.ark_model
        return self._settings.volc_asr_resource_id


def _stable_hash(payload: object) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()
