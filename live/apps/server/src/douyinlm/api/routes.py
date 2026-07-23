from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import ValidationError
from sqlalchemy import distinct, func, select

from douyinlm.domain.schemas import (
    AsyncWorkspaceResponse,
    CategoryCard,
    CategoryDetail,
    CheckArtifactItemRequest,
    CheckArtifactItemResponse,
    CollectionResponse,
    ComponentHealth,
    CreateWorkspaceRequest,
    ExpandWorkspaceScopeRequest,
    ImportManifest,
    ImportResponse,
    JobCard,
    JobEventCard,
    JobListResponse,
    ProvenanceDetail,
    ProvidersHealth,
    ProviderStatus,
    ReadyHealth,
    ReviseArtifactRequest,
    ReviseArtifactResponse,
    RunCompilerRequest,
    RunCompilerResponse,
    SendMessageRequest,
    SubcategoryCard,
    VideoCard,
    WorkspaceCard,
    WorkspaceDetail,
)
from douyinlm.providers.errors import ApiRequestError, PipelineError
from douyinlm.repositories.database import Database, ping_database
from douyinlm.repositories.jobs import append_job_event
from douyinlm.repositories.models import (
    Category,
    CategoryMembership,
    Job,
    JobEvent,
    TaxonomyRun,
    Video,
    VideoAsset,
    Workspace,
)
from douyinlm.services.analysis_jobs import queue_reanalysis
from douyinlm.services.collection_artifact_compiler import CollectionArtifactCompiler
from douyinlm.services.importer import VideoImporter
from douyinlm.services.understanding_data import load_latest_understanding_bundles
from douyinlm.settings import Settings

router = APIRouter(prefix="/api")


def _database(request: Request) -> Database:
    return request.app.state.database


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _importer(request: Request) -> VideoImporter:
    return request.app.state.importer


def _compiler(request: Request) -> CollectionArtifactCompiler:
    return request.app.state.artifact_compiler


@router.get("/health/live")
def health_live() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/ready", response_model=ReadyHealth)
def health_ready(request: Request, response: Response) -> ReadyHealth:
    database = _database(request)
    settings = _settings(request)
    runner = request.app.state.job_runner

    database_ok = ping_database(database.engine)
    filesystem_ok = _writable(settings.resolved_data_dir)
    runner_ok = runner.running
    all_ok = database_ok and filesystem_ok and runner_ok
    if not all_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return ReadyHealth(
        status="ready" if all_ok else "not_ready",
        mode=settings.app_mode,
        database=ComponentHealth(ok=database_ok, detail="SQLite connected"),
        filesystem=ComponentHealth(
            ok=filesystem_ok,
            detail=str(settings.resolved_data_dir),
        ),
        job_runner=ComponentHealth(
            ok=runner_ok,
            detail="Persistent runner active" if runner_ok else "Runner stopped",
        ),
    )


@router.get("/health/providers", response_model=ProvidersHealth)
def health_providers(request: Request) -> ProvidersHealth:
    settings = _settings(request)
    ffmpeg = settings.resolved_ffmpeg_path
    ffprobe = settings.resolved_ffprobe_path
    return ProvidersHealth(
        ark=ProviderStatus(
            configured=settings.ark_api_key is not None,
            required_from_gate="T1",
            detail=settings.ark_model,
        ),
        asr=ProviderStatus(
            configured=settings.asr_configured,
            required_from_gate="T1",
            detail=settings.volc_asr_resource_id,
        ),
        ffmpeg=ProviderStatus(
            configured=ffmpeg is not None and ffprobe is not None,
            required_from_gate="T1",
            detail=str(ffmpeg) if ffmpeg else "运行 scripts\\install-ffmpeg.cmd",
        ),
        web_search_enabled=settings.web_search_enabled,
    )


@router.get("/collection", response_model=CollectionResponse)
def get_collection(request: Request) -> CollectionResponse:
    database = _database(request)
    with database.session() as session:
        videos = session.scalars(select(Video).order_by(Video.created_at.desc())).all()
        workspaces = session.scalars(
            select(Workspace).order_by(Workspace.updated_at.desc()).limit(5)
        ).all()
        latest_taxonomy = session.scalar(
            select(TaxonomyRun)
            .where(TaxonomyRun.status == "completed")
            .order_by(TaxonomyRun.created_at.desc())
            .limit(1)
        )
        categories = _category_cards(session, latest_taxonomy.id if latest_taxonomy else None)
        thumbnail_video_ids = [video.id for video in videos]
        thumbnail_rows = session.execute(
            select(VideoAsset.video_id, VideoAsset.id)
            .where(
                VideoAsset.video_id.in_(thumbnail_video_ids),
                VideoAsset.kind == "keyframe",
            )
            .order_by(VideoAsset.created_at)
        ).all() if thumbnail_video_ids else []
        thumbnail_by_video: dict[str, str] = {}
        for video_id, asset_id in thumbnail_rows:
            thumbnail_by_video.setdefault(video_id, asset_id)
    content_types_by_video = _content_types_by_video(
        database,
        [video.id for video in videos],
    )

    return CollectionResponse(
        is_demo_data=True,
        notice=(
            "这是赛事演示收藏夹，仅使用已获许可的真实视频；"
            "真实产品中，视频收藏后由 AI 在后台理解并自动组织。"
        ),
        videos=[
            VideoCard(
                id=video.id,
                title=video.title,
                author=video.author,
                source_url=video.source_url,
                status=video.status,
                purpose_line=video.purpose_line,
                summary=video.summary,
                content_types=content_types_by_video.get(video.id, []),
                duration_ms=video.duration_ms,
                thumbnail_url=(
                    f"/api/assets/{thumbnail_by_video[video.id]}"
                    if video.id in thumbnail_by_video
                    else None
                ),
                current_job_id=video.current_job_id,
                error_code=video.error_code,
                error_message=video.error_message,
            )
            for video in videos
        ],
        categories=categories,
        recent_workspaces=[
            WorkspaceCard(
                id=workspace.id,
                title=workspace.generated_title,
                state=workspace.state,
                updated_at=_aware(workspace.updated_at),
            )
            for workspace in workspaces
        ],
    )


@router.get("/categories/{category_id}", response_model=CategoryDetail)
def get_category(category_id: str, request: Request) -> CategoryDetail:
    database = _database(request)
    with database.session() as session:
        category = session.get(Category, category_id)
        if category is None:
            raise ApiRequestError(404, "category_not_found", "类目不存在。")
        subcategories = session.scalars(
            select(Category)
            .where(Category.parent_id == category.id)
            .order_by(Category.sort_order, Category.id)
        ).all()
        membership_category_ids = [category.id, *[item.id for item in subcategories]]
        video_ids = list(
            dict.fromkeys(
                session.scalars(
                    select(CategoryMembership.video_id)
                    .where(CategoryMembership.category_id.in_(membership_category_ids))
                    .order_by(CategoryMembership.created_at, CategoryMembership.video_id)
                ).all()
            )
        )
        videos_by_id = {
            video.id: video
            for video in session.scalars(select(Video).where(Video.id.in_(video_ids))).all()
        } if video_ids else {}
        videos = [videos_by_id[video_id] for video_id in video_ids if video_id in videos_by_id]
        thumbnail_by_video = _thumbnail_by_video(session, video_ids)
        subcategory_cards = [
            SubcategoryCard(
                id=subcategory.id,
                name=subcategory.name,
                purpose=subcategory.purpose,
                video_count=int(
                    session.scalar(
                        select(func.count()).where(
                            CategoryMembership.category_id == subcategory.id
                        )
                    )
                    or 0
                ),
            )
            for subcategory in subcategories
        ]
    content_types_by_video = _content_types_by_video(database, video_ids)
    return CategoryDetail(
        id=category.id,
        parent_id=category.parent_id,
        level=category.level,
        name=category.name,
        purpose=category.purpose,
        videos=[
            _video_card(
                video,
                thumbnail_by_video.get(video.id),
                content_types_by_video.get(video.id, []),
            )
            for video in videos
        ],
        subcategories=subcategory_cards,
    )


@router.post(
    "/workspaces",
    response_model=AsyncWorkspaceResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def create_workspace(payload: CreateWorkspaceRequest, request: Request) -> AsyncWorkspaceResponse:
    result = _compiler(request).create_workspace(
        goal=payload.goal,
        scope=payload.launch_scope,
    )
    request.app.state.job_runner.notify()
    return result


@router.post(
    "/workspaces/{workspace_id}/messages",
    response_model=AsyncWorkspaceResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def send_workspace_message(
    workspace_id: str,
    payload: SendMessageRequest,
    request: Request,
) -> AsyncWorkspaceResponse:
    result = _compiler(request).send_message(workspace_id, payload.text)
    request.app.state.job_runner.notify()
    return result


@router.post(
    "/workspaces/{workspace_id}/scope-expansions",
    response_model=AsyncWorkspaceResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def expand_workspace_scope(
    workspace_id: str,
    payload: ExpandWorkspaceScopeRequest,
    request: Request,
) -> AsyncWorkspaceResponse:
    result = _compiler(request).expand_workspace_scope(workspace_id, payload.target)
    request.app.state.job_runner.notify()
    return result


@router.get("/workspaces/{workspace_id}", response_model=WorkspaceDetail)
def get_workspace(workspace_id: str, request: Request) -> WorkspaceDetail:
    return _compiler(request).get_workspace(workspace_id)


@router.post(
    "/artifacts/{artifact_id}/revisions",
    response_model=ReviseArtifactResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def revise_artifact(
    artifact_id: str,
    payload: ReviseArtifactRequest,
    request: Request,
) -> ReviseArtifactResponse:
    result = _compiler(request).revise_artifact(artifact_id, payload.instruction)
    request.app.state.job_runner.notify()
    return result


@router.patch(
    "/artifacts/{artifact_id}/items/{item_id}",
    response_model=CheckArtifactItemResponse,
)
def check_artifact_item(
    artifact_id: str,
    item_id: str,
    payload: CheckArtifactItemRequest,
    request: Request,
) -> CheckArtifactItemResponse:
    return _compiler(request).check_item(artifact_id, item_id, payload.checked)


@router.get("/provenance/{provenance_id}", response_model=ProvenanceDetail)
def get_provenance(provenance_id: str, request: Request) -> ProvenanceDetail:
    return _compiler(request).get_provenance(provenance_id)


@router.post(
    "/skills/collection-artifact-compiler/run",
    response_model=RunCompilerResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def run_collection_artifact_compiler(
    payload: RunCompilerRequest,
    request: Request,
) -> RunCompilerResponse:
    if payload.tool_policy.allow_web_search and not _settings(request).web_search_enabled:
        raise ApiRequestError(
            400,
            "web_search_not_available",
            "当前运行环境未启用联网研究；已拒绝静默扩大工具范围。",
        )
    result = _compiler(request).create_workspace(
        goal=payload.goal,
        scope=payload.scope,
        conversation=payload.conversation,
        generation_authorized=payload.tool_policy.generation_authorized,
    )
    request.app.state.job_runner.notify()
    return RunCompilerResponse(workspace_id=result.workspace_id, job_id=result.job_id)


@router.post(
    "/videos/import",
    response_model=ImportResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def import_videos(
    request: Request,
    files: Annotated[list[UploadFile], File()],
    manifest_json: Annotated[str, Form()] = '{"schema_version":1,"videos":[]}',
    permission_confirmed: Annotated[bool, Form()] = False,
    permission_scope: Annotated[str, Form()] = "下载、AI 处理、Web 展示与现场演示",
) -> ImportResponse:
    if not files:
        raise PipelineError("no_files", "请至少选择一个视频。")
    if not permission_confirmed:
        raise PipelineError("permission_required", "导入前必须确认素材许可范围。")
    if not permission_scope.strip():
        raise PipelineError("permission_scope_required", "许可说明不能为空。")
    try:
        manifest = ImportManifest.model_validate_json(manifest_json)
    except (ValidationError, ValueError) as exc:
        raise PipelineError("invalid_manifest", "sidecar manifest 不是有效格式。") from exc
    return await _importer(request).import_uploads(
        files,
        manifest=manifest,
        permission_scope=permission_scope.strip(),
    )


@router.post("/videos/{video_id}/reanalyze", response_model=JobCard)
def reanalyze_video(video_id: str, request: Request) -> JobCard:
    database = _database(request)
    job_id = queue_reanalysis(database, video_id)
    if job_id is None:
        raise HTTPException(status_code=404, detail="Video not found")
    request.app.state.job_runner.notify()
    return _job_card(database, job_id)


@router.get("/jobs", response_model=JobListResponse)
def list_jobs(request: Request, limit: int = 30) -> JobListResponse:
    database = _database(request)
    safe_limit = max(1, min(100, limit))
    with database.session() as session:
        job_ids = session.scalars(
            select(Job.id).order_by(Job.created_at.desc()).limit(safe_limit)
        ).all()
    return JobListResponse(jobs=[_job_card(database, job_id) for job_id in job_ids])


@router.get("/jobs/{job_id}", response_model=JobCard)
def get_job(job_id: str, request: Request) -> JobCard:
    return _job_card(_database(request), job_id)


@router.post("/jobs/{job_id}/retry", response_model=JobCard)
def retry_job(job_id: str, request: Request) -> JobCard:
    database = _database(request)
    with database.session() as session:
        job = session.get(Job, job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        if job.status not in {"failed", "blocked"}:
            raise PipelineError("job_not_retryable", "只有失败或等待配置的任务可以重试。")
        job.status = "queued"
        job.last_error = None
        video_id = str(job.payload_json.get("video_id", ""))
        video = session.get(Video, video_id) if video_id else None
        if video is not None:
            video.status = "queued"
            video.error_code = None
            video.error_message = None
        workspace_id = str(job.payload_json.get("workspace_id", ""))
        workspace = session.get(Workspace, workspace_id) if workspace_id else None
        if workspace is not None:
            workspace.state = "compiling" if job.kind == "revise_artifact" else "forming"
            workspace.active_job_id = job.id
        session.commit()
    append_job_event(
        database,
        job_id,
        stage="queued",
        progress=0,
        message="任务已重新加入后台队列。",
    )
    request.app.state.job_runner.notify()
    return _job_card(database, job_id)


@router.get("/jobs/{job_id}/events")
async def job_events(job_id: str, request: Request) -> StreamingResponse:
    database = _database(request)
    with database.session() as session:
        if session.get(Job, job_id) is None:
            raise HTTPException(status_code=404, detail="Job not found")
    try:
        last_sequence = int(request.headers.get("last-event-id", "0"))
    except ValueError:
        last_sequence = 0

    async def stream() -> object:
        nonlocal last_sequence
        while True:
            if await request.is_disconnected():
                break
            with database.session() as session:
                events = session.scalars(
                    select(JobEvent)
                    .where(
                        JobEvent.job_id == job_id,
                        JobEvent.sequence > last_sequence,
                    )
                    .order_by(JobEvent.sequence)
                ).all()
                job_status = session.scalar(select(Job.status).where(Job.id == job_id))
            for event in events:
                last_sequence = event.sequence
                payload = {
                    "sequence": event.sequence,
                    "stage": event.stage,
                    "progress": event.progress,
                    "message": event.message,
                    "created_at": event.created_at.isoformat(),
                }
                yield (
                    f"id: {event.sequence}\n"
                    "event: progress\n"
                    f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                )
            if job_status in {"completed", "failed", "blocked"} and not events:
                break
            yield ": heartbeat\n\n"
            await asyncio.sleep(0.6)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/assets/{asset_id}")
def get_asset(asset_id: str, request: Request) -> FileResponse:
    database = _database(request)
    settings = _settings(request)
    with database.session() as session:
        asset = session.get(VideoAsset, asset_id)
        if asset is None or asset.kind not in {"keyframe", "proxy"}:
            raise HTTPException(status_code=404, detail="Asset not found")
        path = (settings.resolved_data_dir / asset.relative_path).resolve()
    if not path.is_relative_to(settings.resolved_data_dir) or not path.is_file():
        raise HTTPException(status_code=404, detail="Asset file not found")
    return FileResponse(path, media_type=asset.mime_type)


def _category_cards(session: object, taxonomy_run_id: str | None) -> list[CategoryCard]:
    if taxonomy_run_id is None:
        return []
    majors = session.scalars(
        select(Category)
        .where(Category.taxonomy_run_id == taxonomy_run_id, Category.level == 1)
        .order_by(Category.sort_order)
    ).all()
    cards: list[CategoryCard] = []
    for major in majors:
        subcategories = session.scalars(
            select(Category)
            .where(Category.parent_id == major.id)
            .order_by(Category.sort_order)
        ).all()
        subcards: list[SubcategoryCard] = []
        for subcategory in subcategories:
            count = int(
                session.scalar(
                    select(func.count()).where(
                        CategoryMembership.category_id == subcategory.id
                    )
                )
                or 0
            )
            subcards.append(
                SubcategoryCard(
                    id=subcategory.id,
                    name=subcategory.name,
                    purpose=subcategory.purpose,
                    video_count=count,
                )
            )
        major_count = int(
            session.scalar(
                select(func.count(distinct(CategoryMembership.video_id)))
                .select_from(CategoryMembership)
                .join(Category, Category.id == CategoryMembership.category_id)
                .where(Category.parent_id == major.id)
            )
            or 0
        )
        cards.append(
            CategoryCard(
                id=major.id,
                name=major.name,
                purpose=major.purpose,
                video_count=major_count,
                subcategories=subcards,
            )
        )
    return cards


def _job_card(database: Database, job_id: str) -> JobCard:
    with database.session() as session:
        job = session.get(Job, job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        latest = session.scalar(
            select(JobEvent)
            .where(JobEvent.job_id == job.id)
            .order_by(JobEvent.sequence.desc())
            .limit(1)
        )
        return JobCard(
            id=job.id,
            kind=job.kind,
            status=job.status,
            video_id=(
                str(job.payload_json.get("video_id"))
                if job.payload_json.get("video_id")
                else None
            ),
            attempts=job.attempts,
            last_error=job.last_error,
            created_at=_aware(job.created_at),
            updated_at=_aware(job.updated_at),
            latest_event=(
                JobEventCard(
                    sequence=latest.sequence,
                    stage=latest.stage,
                    progress=latest.progress,
                    message=latest.message,
                    created_at=_aware(latest.created_at),
                )
                if latest
                else None
            ),
        )


def _writable(path: Path) -> bool:
    return path.exists() and path.is_dir()


def _thumbnail_by_video(session: object, video_ids: list[str]) -> dict[str, str]:
    if not video_ids:
        return {}
    rows = session.execute(
        select(VideoAsset.video_id, VideoAsset.id)
        .where(VideoAsset.video_id.in_(video_ids), VideoAsset.kind == "keyframe")
        .order_by(VideoAsset.created_at, VideoAsset.id)
    ).all()
    result: dict[str, str] = {}
    for video_id, asset_id in rows:
        result.setdefault(video_id, asset_id)
    return result


def _content_types_by_video(
    database: Database,
    video_ids: list[str],
) -> dict[str, list[str]]:
    if not video_ids:
        return {}
    bundles = load_latest_understanding_bundles(
        database,
        video_ids,
        require_all=False,
    )
    return {bundle.video_id: list(bundle.content_types) for bundle in bundles}


def _video_card(
    video: Video,
    thumbnail_asset_id: str | None,
    content_types: list[str],
) -> VideoCard:
    return VideoCard(
        id=video.id,
        title=video.title,
        author=video.author,
        source_url=video.source_url,
        status=video.status,
        purpose_line=video.purpose_line,
        summary=video.summary,
        content_types=content_types,
        duration_ms=video.duration_ms,
        thumbnail_url=(f"/api/assets/{thumbnail_asset_id}" if thumbnail_asset_id else None),
        current_job_id=video.current_job_id,
        error_code=video.error_code,
        error_message=video.error_message,
    )


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)
