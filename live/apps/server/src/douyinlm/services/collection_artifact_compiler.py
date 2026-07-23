from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, select

from douyinlm.domain.schemas import (
    AdoptedVideo,
    ArtifactCompactVariant,
    ArtifactConflictDetail,
    ArtifactConflictViewpoint,
    ArtifactDocument,
    ArtifactDraft,
    ArtifactItem,
    ArtifactSection,
    AsyncWorkspaceResponse,
    CheckArtifactItemResponse,
    CompilerConversationMessage,
    ExcludedVideo,
    JobCard,
    JobEventCard,
    LaunchScope,
    ProvenanceDetail,
    ReviseArtifactResponse,
    ScopeExpansionOption,
    ScopeExpansionTarget,
    VideoProvenanceView,
    WebProvenanceView,
    WorkspaceDetail,
)
from douyinlm.domain.schemas import (
    WorkspaceMessage as WorkspaceMessageSchema,
)
from douyinlm.providers.compiler import CompilerProvider, RevisionSourceRefs
from douyinlm.providers.errors import ApiRequestError, PipelineError
from douyinlm.repositories.database import Database
from douyinlm.repositories.jobs import append_job_event
from douyinlm.repositories.models import (
    Artifact,
    ArtifactItemProvenance,
    ArtifactItemRecord,
    ArtifactSectionRecord,
    ArtifactVersion,
    Category,
    CategoryMembership,
    Job,
    JobEvent,
    ProvenanceRef,
    ProviderCall,
    Video,
    VideoAsset,
    Workspace,
    WorkspaceMessage,
    WorkspaceSource,
    new_id,
    utc_now,
)
from douyinlm.services.understanding_data import load_latest_understanding_bundles

_DIRECT_SUPPORT_CONCEPTS: dict[str, tuple[str, ...]] = {
    "存储空间": ("缓存", "存储", "内存", "容量", "预留空间", "可用空间"),
    "电量续航": ("电量", "电池", "充电", "续航"),
    "镜头清洁": ("擦镜头", "清洁镜头", "镜头灰尘", "镜头污渍"),
    "检查复核": ("检查", "核对", "回看", "复查", "确认", "验收"),
    "对焦清晰": ("对焦", "焦点", "清晰", "虚焦", "失焦", "跑焦", "模糊"),
    "选片删片": ("筛选", "选片", "挑片", "成片", "废片", "删片", "精选"),
    "备份导出": ("备份", "同步", "导出", "保存原片"),
    "曝光明暗": (
        "曝光",
        "高光",
        "阴影",
        "暗部",
        "亮部",
        "过曝",
        "欠曝",
        "提亮",
        "压暗",
    ),
    "构图位置": (
        "构图",
        "九宫格",
        "三分法",
        "四格",
        "六格",
        "居中",
        "左上",
        "右上",
        "左下",
        "右下",
    ),
    "拍摄距离": ("后退", "前进", "靠近", "远离", "距离", "米远", "焦距"),
    "人物姿势": ("坐姿", "站姿", "蹲下", "坐下", "站立", "侧身"),
    "互动时机": (
        "互动",
        "递东西",
        "走动",
        "走路",
        "回头",
        "抓拍",
        "瞬间",
        "聊天",
        "微笑",
    ),
    "光线天气": ("晴天", "阴天", "阳光", "太阳", "逆光", "顺光", "侧光", "光线"),
    "相机参数": ("快门", "iso", "感光度", "白平衡", "hdr", "人像模式", "连拍"),
    "拍摄机位": ("仰拍", "俯拍", "平拍", "低机位", "高机位", "镜头高度"),
    "画面景别": ("全身", "半身", "特写", "景别", "近景", "远景"),
}
_SUPPORT_CLAUSE_SPLIT_RE = re.compile(r"并且|以及|同时|然后|[，,。；;、/]")
_SUPPORT_TEXT_NORMALIZE_RE = re.compile(r"[^0-9a-z\u4e00-\u9fff]+")


@dataclass(frozen=True)
class EvidenceEntry:
    ref: str
    kind: str
    source_id: str
    evidence_summary: str
    confidence: float | None
    start_ms: int | None
    end_ms: int | None

    def prompt_value(self) -> dict[str, Any]:
        return {
            "ref": self.ref,
            "kind": self.kind,
            "source_id": self.source_id,
            "evidence_summary": self.evidence_summary,
            "confidence": self.confidence,
            "start_ms": self.start_ms,
            "end_ms": self.end_ms,
        }


def _queued_job_event(job_id: str, message: str) -> JobEvent:
    return JobEvent(
        job_id=job_id,
        sequence=1,
        stage="queued",
        progress=0,
        message=message,
        detail_json={},
    )


class CollectionArtifactCompiler:
    def __init__(self, database: Database, provider: CompilerProvider) -> None:
        self._database = database
        self._provider = provider

    def create_workspace(
        self,
        *,
        goal: str,
        scope: LaunchScope,
        conversation: list[CompilerConversationMessage] | None = None,
        generation_authorized: bool | None = None,
    ) -> AsyncWorkspaceResponse:
        candidate_video_ids = resolve_scope_video_ids(self._database, scope)
        workspace = Workspace(
            id=new_id(),
            generated_title=_initial_title(goal),
            original_goal=goal,
            launch_scope_json=scope.model_dump(mode="json"),
            confirmed_constraints_json=[],
            clarification_count=0,
            state="forming",
        )
        job = Job(
            id=new_id(),
            kind="compile_workspace",
            status="queued",
            payload_json={
                "workspace_id": workspace.id,
                "candidate_video_ids": candidate_video_ids,
                "generation_authorized": (
                    _goal_authorizes_generation(goal)
                    if generation_authorized is None
                    else generation_authorized
                ),
            },
        )
        workspace.active_job_id = job.id
        with self._database.session() as session:
            session.add_all(
                [
                    workspace,
                    job,
                    _queued_job_event(
                        job.id,
                        "工作区已创建，等待编译收藏内容。",
                    ),
                ]
            )
            prior_messages = list(conversation or [])
            for message in prior_messages:
                session.add(
                    WorkspaceMessage(
                        workspace_id=workspace.id,
                        role=message.role,
                        content=message.content,
                    )
                )
            if not prior_messages or prior_messages[-1].content.strip() != goal:
                session.add(
                    WorkspaceMessage(
                        workspace_id=workspace.id,
                        role="user",
                        content=goal,
                    )
                )
            session.commit()
        return AsyncWorkspaceResponse(
            workspace_id=workspace.id,
            job_id=job.id,
            state="forming",
        )

    def send_message(self, workspace_id: str, text: str) -> AsyncWorkspaceResponse:
        with self._database.session() as session:
            workspace = session.get(Workspace, workspace_id)
            if workspace is None:
                raise ApiRequestError(404, "workspace_not_found", "工作区不存在。")
            if workspace.state != "clarifying" or workspace.clarification_count != 1:
                raise ApiRequestError(
                    409,
                    "workspace_not_awaiting_message",
                    "当前工作区不在等待关键补充信息。",
                )
            previous_job = (
                session.get(Job, workspace.active_job_id) if workspace.active_job_id else None
            )
            candidate_video_ids = (
                list(previous_job.payload_json.get("candidate_video_ids", []))
                if previous_job is not None
                else []
            )
            if not candidate_video_ids:
                scope = LaunchScope.model_validate(workspace.launch_scope_json)
                candidate_video_ids = resolve_scope_video_ids(self._database, scope)
            constraints = list(workspace.confirmed_constraints_json or [])
            if text not in constraints:
                constraints.append(text)
            workspace.confirmed_constraints_json = constraints
            workspace.state = "compiling"
            session.add(
                WorkspaceMessage(workspace_id=workspace.id, role="user", content=text)
            )
            job = Job(
                id=new_id(),
                kind="compile_workspace",
                status="queued",
                payload_json={
                    "workspace_id": workspace.id,
                    "candidate_video_ids": candidate_video_ids,
                    "generation_authorized": True,
                },
            )
            workspace.active_job_id = job.id
            session.add_all(
                [
                    job,
                    _queued_job_event(
                        job.id,
                        "已收到关键补充，继续编译同一工作区。",
                    ),
                ]
            )
            session.commit()
        return AsyncWorkspaceResponse(
            workspace_id=workspace_id,
            job_id=job.id,
            state="compiling",
        )

    def expand_workspace_scope(
        self,
        workspace_id: str,
        target: ScopeExpansionTarget,
    ) -> AsyncWorkspaceResponse:
        with self._database.session() as session:
            workspace = session.get(Workspace, workspace_id)
            if workspace is None:
                raise ApiRequestError(404, "workspace_not_found", "工作区不存在。")
            active_job = (
                session.get(Job, workspace.active_job_id)
                if workspace.active_job_id is not None
                else None
            )
            if active_job is not None and active_job.status in {"queued", "running"}:
                raise ApiRequestError(
                    409,
                    "workspace_busy",
                    "当前工作区仍在处理上一项任务。",
                    retryable=True,
                )
            if workspace.state != "failed":
                raise ApiRequestError(
                    409,
                    "workspace_scope_expansion_not_allowed",
                    "只有因当前范围证据不足而失败的工作区可以扩大范围。",
                )
            available_options = _scope_expansion_options(
                self._database,
                session,
                workspace,
            )
            selected_option = next(
                (option for option in available_options if option.target == target),
                None,
            )
            if selected_option is None:
                raise ApiRequestError(
                    409,
                    "scope_expansion_not_available",
                    "当前工作区不提供该范围扩大选项。",
                )

            current_scope = LaunchScope.model_validate(workspace.launch_scope_json)
            target_scope = _expanded_scope(session, current_scope, target)
            if target_scope is None:
                raise ApiRequestError(
                    409,
                    "scope_expansion_not_available",
                    "当前工作区不提供该范围扩大选项。",
                )
            candidate_video_ids = resolve_scope_video_ids(self._database, target_scope)
            original_label = _scope_label(session, current_scope)
            target_label = _scope_label(session, target_scope)
            job = Job(
                id=new_id(),
                kind="compile_workspace",
                status="queued",
                payload_json={
                    "workspace_id": workspace.id,
                    "candidate_video_ids": candidate_video_ids,
                    "generation_authorized": True,
                },
            )
            workspace.launch_scope_json = target_scope.model_dump(mode="json")
            workspace.state = "compiling"
            workspace.active_job_id = job.id
            session.add_all(
                [
                    job,
                    _queued_job_event(
                        job.id,
                        (
                            f"已扩大到{target_label}，等待重新编译 "
                            f"{len(candidate_video_ids)} 条候选视频。"
                        ),
                    ),
                    WorkspaceMessage(
                        workspace_id=workspace.id,
                        role="system_event",
                        content=(
                            f"已将范围从「{original_label}」扩大到「{target_label}」，"
                            f"重新纳入 {len(candidate_video_ids)} 条候选视频。"
                        ),
                    ),
                ]
            )
            session.commit()
        return AsyncWorkspaceResponse(
            workspace_id=workspace_id,
            job_id=job.id,
            state="compiling",
        )

    def revise_artifact(self, artifact_id: str, instruction: str) -> ReviseArtifactResponse:
        with self._database.session() as session:
            artifact = session.get(Artifact, artifact_id)
            if artifact is None:
                raise ApiRequestError(404, "artifact_not_found", "Artifact 不存在。")
            workspace = session.get(Workspace, artifact.workspace_id)
            if workspace is None:
                raise ApiRequestError(404, "workspace_not_found", "工作区不存在。")
            if workspace.active_job_id:
                active = session.get(Job, workspace.active_job_id)
                if active is not None and active.status in {"queued", "running"}:
                    raise ApiRequestError(
                        409,
                        "workspace_busy",
                        "当前工作区仍在处理上一项任务。",
                        retryable=True,
                    )
            version_before = artifact.version
            job = Job(
                id=new_id(),
                kind="revise_artifact",
                status="queued",
                payload_json={
                    "workspace_id": workspace.id,
                    "artifact_id": artifact.id,
                    "instruction": instruction,
                },
            )
            workspace.state = "compiling"
            workspace.active_job_id = job.id
            session.add_all(
                [
                    job,
                    _queued_job_event(
                        job.id,
                        "修改指令已加入后台任务。",
                    ),
                    WorkspaceMessage(
                        workspace_id=workspace.id,
                        role="user",
                        content=instruction,
                    ),
                ]
            )
            session.commit()
        return ReviseArtifactResponse(
            artifact_id=artifact_id,
            job_id=job.id,
            version_before=version_before,
        )

    def check_item(
        self,
        artifact_id: str,
        item_id: str,
        checked: bool,
    ) -> CheckArtifactItemResponse:
        with self._database.session() as session:
            artifact = session.get(Artifact, artifact_id)
            if artifact is None:
                raise ApiRequestError(404, "artifact_not_found", "Artifact 不存在。")
            item = session.get(ArtifactItemRecord, item_id)
            if item is None or item.artifact_id != artifact.id:
                raise ApiRequestError(404, "artifact_item_not_found", "任务卡项目不存在。")
            item.checked = checked
            item.updated_at = utc_now()
            session.commit()
            updated_at = item.updated_at
        return CheckArtifactItemResponse(
            artifact_id=artifact_id,
            item_id=item_id,
            checked=checked,
            updated_at=_aware(updated_at),
        )

    def get_workspace(self, workspace_id: str) -> WorkspaceDetail:
        with self._database.session() as session:
            workspace = session.get(Workspace, workspace_id)
            if workspace is None:
                raise ApiRequestError(404, "workspace_not_found", "工作区不存在。")
            sources = session.scalars(
                select(WorkspaceSource)
                .where(WorkspaceSource.workspace_id == workspace.id)
                .order_by(WorkspaceSource.created_at, WorkspaceSource.id)
            ).all()
            messages = session.scalars(
                select(WorkspaceMessage)
                .where(WorkspaceMessage.workspace_id == workspace.id)
                .order_by(WorkspaceMessage.created_at, WorkspaceMessage.id)
            ).all()
            artifact = (
                session.get(Artifact, workspace.current_artifact_id)
                if workspace.current_artifact_id
                else None
            )
            detail = WorkspaceDetail(
                id=workspace.id,
                generated_title=workspace.generated_title,
                original_goal=workspace.original_goal,
                launch_scope=LaunchScope.model_validate(workspace.launch_scope_json),
                state=workspace.state,
                adopted_videos=[
                    AdoptedVideo(video_id=item.video_id, reason=item.reason)
                    for item in sources
                    if item.decision == "adopted"
                ],
                excluded_videos=[
                    ExcludedVideo(video_id=item.video_id, reason=item.reason)
                    for item in sources
                    if item.decision == "excluded"
                ],
                confirmed_constraints=list(workspace.confirmed_constraints_json or []),
                messages=[
                    WorkspaceMessageSchema(
                        id=item.id,
                        role=item.role,
                        content=item.content,
                        created_at=_aware(item.created_at),
                    )
                    for item in messages
                ],
                scope_expansion_options=_scope_expansion_options(
                    self._database,
                    session,
                    workspace,
                ),
                active_job=(
                    _job_card(session, workspace.active_job_id)
                    if workspace.active_job_id is not None
                    else None
                ),
                artifact=_artifact_document(session, artifact) if artifact is not None else None,
                created_at=_aware(workspace.created_at),
                updated_at=_aware(workspace.updated_at),
            )
        return detail

    def get_provenance(self, provenance_id: str) -> ProvenanceDetail:
        with self._database.session() as session:
            provenance = session.get(ProvenanceRef, provenance_id)
            if provenance is None:
                raise ApiRequestError(404, "provenance_not_found", "来源不存在或不可访问。")
            video_view: VideoProvenanceView | None = None
            web_view: WebProvenanceView | None = None
            if provenance.kind == "video":
                video = session.get(Video, provenance.source_id)
                if video is None:
                    raise ApiRequestError(404, "provenance_not_found", "视频来源不存在。")
                assets = session.scalars(
                    select(VideoAsset)
                    .where(
                        VideoAsset.video_id == video.id,
                        VideoAsset.kind.in_(["keyframe", "proxy"]),
                    )
                    .order_by(VideoAsset.created_at, VideoAsset.id)
                ).all()
                thumbnail = next((item for item in assets if item.kind == "keyframe"), None)
                proxy = next((item for item in assets if item.kind == "proxy"), None)
                video_view = VideoProvenanceView(
                    title=video.title,
                    author=video.author,
                    thumbnail_url=f"/api/assets/{thumbnail.id}" if thumbnail else None,
                    playback_url=f"/api/assets/{proxy.id}" if proxy else None,
                    source_url=video.source_url,
                )
            elif provenance.kind == "web":
                if not provenance.web_title or not provenance.web_url:
                    raise ApiRequestError(404, "provenance_not_found", "网页来源不完整。")
                web_view = WebProvenanceView(
                    title=provenance.web_title,
                    url=provenance.web_url,
                    publisher=provenance.web_publisher,
                )
            return ProvenanceDetail(
                id=provenance.id,
                kind=provenance.kind,
                source_id=provenance.source_id,
                evidence_summary=provenance.evidence_summary,
                confidence=provenance.confidence,
                start_ms=provenance.start_ms,
                end_ms=provenance.end_ms,
                retrieved_at=(
                    _aware(provenance.retrieved_at)
                    if provenance.retrieved_at is not None
                    else None
                ),
                video=video_view,
                web=web_view,
            )

    def handle_compile_job(self, job_id: str, payload: dict[str, Any]) -> None:
        workspace_id = str(payload["workspace_id"])
        try:
            candidate_video_ids = [str(item) for item in payload["candidate_video_ids"]]
            append_job_event(
                self._database,
                job_id,
                stage="resolving_scope",
                progress=15,
                message=f"已锁定 {len(candidate_video_ids)} 条候选视频。",
            )
            bundles = load_latest_understanding_bundles(self._database, candidate_video_ids)
            catalog = _build_evidence_catalog(workspace_id, bundles)
            append_job_event(
                self._database,
                job_id,
                stage="selecting_sources",
                progress=35,
                message="正在选择与目标真正相关的视频并解释排除原因。",
            )
            with self._database.session() as session:
                workspace = session.get(Workspace, workspace_id)
                if workspace is None:
                    raise ApiRequestError(404, "workspace_not_found", "工作区不存在。")
                conversation = [
                    {"role": message.role, "content": message.content}
                    for message in session.scalars(
                        select(WorkspaceMessage)
                        .where(
                            WorkspaceMessage.workspace_id == workspace.id,
                            WorkspaceMessage.role.in_(["user", "assistant"]),
                        )
                        .order_by(WorkspaceMessage.created_at, WorkspaceMessage.id)
                    ).all()
                ]
                goal = workspace.original_goal
                clarification_used = workspace.clarification_count > 0
            append_job_event(
                self._database,
                job_id,
                stage="deciding_gap",
                progress=50,
                message="正在判断是否只缺一个会改变结果的关键条件。",
            )
            result = self._provider.compile(
                goal=goal,
                candidates=bundles,
                evidence_catalog=[entry.prompt_value() for entry in catalog],
                conversation=conversation,
                clarification_used=clarification_used,
                generation_authorized=bool(payload.get("generation_authorized", False)),
            )
            self._record_provider_call(job_id, workspace_id, "compile_collection_artifact", result)
            _validate_compilation_result(
                result.draft,
                candidate_video_ids,
                catalog,
                clarification_used=clarification_used,
                generation_authorized=bool(payload.get("generation_authorized", False)),
            )
            with self._database.session() as session:
                workspace = session.get(Workspace, workspace_id)
                if workspace is None:
                    raise ApiRequestError(404, "workspace_not_found", "工作区不存在。")
                _replace_video_decisions(session, workspace.id, result.draft)
                workspace.generated_title = result.draft.generated_title
                merged_constraints = list(workspace.confirmed_constraints_json or [])
                for constraint in result.draft.confirmed_constraints:
                    if constraint not in merged_constraints:
                        merged_constraints.append(constraint)
                workspace.confirmed_constraints_json = merged_constraints
                if result.draft.clarification_question is not None:
                    workspace.state = "clarifying"
                    workspace.clarification_count += 1
                    session.add(
                        WorkspaceMessage(
                            workspace_id=workspace.id,
                            role="assistant",
                            content=result.draft.clarification_question,
                        )
                    )
                    session.commit()
                    append_job_event(
                        self._database,
                        job_id,
                        stage="completed",
                        progress=100,
                        message="需要一个关键补充后再生成任务卡。",
                    )
                    return
                workspace.state = "compiling"
                session.commit()
            append_job_event(
                self._database,
                job_id,
                stage="compiling",
                progress=75,
                message="正在编译三阶段现场拍摄任务卡。",
            )
            append_job_event(
                self._database,
                job_id,
                stage="validating_provenance",
                progress=90,
                message="正在校验每个行动项的视频时间点。",
            )
            if result.draft.artifact is None:
                raise PipelineError("artifact_validation_failed", "模型没有返回任务卡。")
            with self._database.session() as session:
                workspace = session.get(Workspace, workspace_id)
                if workspace is None:
                    raise ApiRequestError(404, "workspace_not_found", "工作区不存在。")
                document = _persist_artifact(
                    session,
                    workspace,
                    result.draft.artifact,
                    catalog,
                    job_id=job_id,
                    instruction=None,
                )
                workspace.state = "ready"
                session.add_all(
                    [
                        WorkspaceMessage(
                            workspace_id=workspace.id,
                            role="system_event",
                            content=(
                                f"已采用 {len(result.draft.adopted_videos)} 条视频，"
                                f"排除 {len(result.draft.excluded_videos)} 条；本次未联网。"
                            ),
                        ),
                        WorkspaceMessage(
                            workspace_id=workspace.id,
                            role="assistant",
                            content=(
                                f"{document.title}已生成。每个行动项都可查看真实视频时间点。"
                            ),
                        ),
                    ]
                )
                session.commit()
            append_job_event(
                self._database,
                job_id,
                stage="completed",
                progress=100,
                message="任务卡已完成并通过来源校验。",
            )
        except Exception as exc:
            _mark_workspace_failed(self._database, workspace_id, _public_error_message(exc))
            raise

    def handle_revision_job(self, job_id: str, payload: dict[str, Any]) -> None:
        workspace_id = str(payload["workspace_id"])
        artifact_id = str(payload["artifact_id"])
        instruction = str(payload["instruction"])
        try:
            append_job_event(
                self._database,
                job_id,
                stage="compiling",
                progress=55,
                message="正在按新指令修改同一份任务卡。",
            )
            with self._database.session() as session:
                workspace = session.get(Workspace, workspace_id)
                artifact = session.get(Artifact, artifact_id)
                if workspace is None or artifact is None or artifact.workspace_id != workspace.id:
                    raise ApiRequestError(404, "artifact_not_found", "Artifact 不存在。")
                current = _artifact_document(session, artifact)
                adopted_ids = session.scalars(
                    select(WorkspaceSource.video_id).where(
                        WorkspaceSource.workspace_id == workspace.id,
                        WorkspaceSource.decision == "adopted",
                    )
                ).all()
                goal = workspace.original_goal
            bundles = load_latest_understanding_bundles(self._database, adopted_ids)
            catalog = _build_evidence_catalog(workspace_id, bundles)
            current_source_refs = _revision_source_refs(
                self._database,
                workspace_id,
                current,
                catalog,
            )
            result = self._provider.revise(
                goal=goal,
                instruction=instruction,
                current_artifact=current.model_dump(mode="json"),
                current_source_refs=current_source_refs,
                evidence_catalog=[entry.prompt_value() for entry in catalog],
            )
            self._record_provider_call(job_id, workspace_id, "revise_collection_artifact", result)
            _validate_artifact_sources(result.draft, set(adopted_ids), catalog)
            append_job_event(
                self._database,
                job_id,
                stage="validating_provenance",
                progress=90,
                message="正在确认修改后仍保留有效来源。",
            )
            with self._database.session() as session:
                workspace = session.get(Workspace, workspace_id)
                artifact = session.get(Artifact, artifact_id)
                if workspace is None or artifact is None:
                    raise ApiRequestError(404, "artifact_not_found", "Artifact 不存在。")
                document = _persist_artifact(
                    session,
                    workspace,
                    result.draft,
                    catalog,
                    job_id=job_id,
                    instruction=instruction,
                )
                workspace.state = "ready"
                session.add(
                    WorkspaceMessage(
                        workspace_id=workspace.id,
                        role="assistant",
                        content=f"已按你的指令更新同一份任务卡，当前为 v{document.version}。",
                    )
                )
                session.commit()
            append_job_event(
                self._database,
                job_id,
                stage="completed",
                progress=100,
                message="同一 Artifact 已完成修改并保留来源。",
            )
        except Exception as exc:
            _mark_workspace_failed(self._database, workspace_id, _public_error_message(exc))
            raise

    def _record_provider_call(
        self,
        job_id: str,
        workspace_id: str,
        operation: str,
        result: Any,
    ) -> None:
        with self._database.session() as session:
            session.add(
                ProviderCall(
                    analysis_run_id=None,
                    workspace_id=workspace_id,
                    job_id=job_id,
                    provider="ark",
                    operation=operation,
                    model_id=result.model_id,
                    status="completed",
                    request_hash=result.request_hash,
                    response_hash=result.response_hash,
                    response_id=result.response_id,
                    duration_ms=result.duration_ms,
                )
            )
            session.commit()


def _scope_expansion_options(
    database: Database,
    session: Any,
    workspace: Workspace,
) -> list[ScopeExpansionOption]:
    if workspace.state != "failed" or workspace.active_job_id is None:
        return []
    active_job = session.get(Job, workspace.active_job_id)
    if (
        active_job is None
        or active_job.kind != "compile_workspace"
        or active_job.status != "failed"
    ):
        return []
    latest_event = session.scalar(
        select(JobEvent)
        .where(JobEvent.job_id == active_job.id)
        .order_by(JobEvent.sequence.desc())
        .limit(1)
    )
    if (
        latest_event is None
        or latest_event.detail_json.get("code") != "insufficient_scope_evidence"
    ):
        return []

    current_scope = LaunchScope.model_validate(workspace.launch_scope_json)
    try:
        current_video_ids = set(resolve_scope_video_ids(database, current_scope))
    except ApiRequestError:
        return []
    options: list[ScopeExpansionOption] = []
    for target in ("parent", "home"):
        target_scope = _expanded_scope(session, current_scope, target)
        if target_scope is None:
            continue
        try:
            target_video_ids = set(resolve_scope_video_ids(database, target_scope))
        except ApiRequestError:
            continue
        if not current_video_ids < target_video_ids:
            continue
        options.append(
            ScopeExpansionOption(
                target=target,
                label=(
                    f"扩大到「{_scope_label(session, target_scope)}」"
                    if target == "parent"
                    else "扩大到全部收藏"
                ),
                candidate_count=len(target_video_ids),
            )
        )
    return options


def _expanded_scope(
    session: Any,
    current_scope: LaunchScope,
    target: ScopeExpansionTarget,
) -> LaunchScope | None:
    if target == "home":
        if current_scope.mode == "home":
            return None
        return LaunchScope(mode="home", category_id=None, video_ids=[])
    if current_scope.mode != "subcategory" or current_scope.category_id is None:
        return None
    category = session.get(Category, current_scope.category_id)
    if category is None or category.level != 2 or category.parent_id is None:
        return None
    parent = session.get(Category, category.parent_id)
    if parent is None or parent.level != 1:
        return None
    return LaunchScope(mode="major", category_id=parent.id, video_ids=[])


def _scope_label(session: Any, scope: LaunchScope) -> str:
    if scope.mode == "home":
        return "全部收藏"
    if scope.mode in {"major", "subcategory"} and scope.category_id is not None:
        category = session.get(Category, scope.category_id)
        if category is not None:
            return category.name
    if scope.mode == "single":
        return "单条视频"
    return f"已选 {len(scope.video_ids)} 条视频"


def resolve_scope_video_ids(database: Database, scope: LaunchScope) -> list[str]:
    with database.session() as session:
        if scope.mode == "home":
            video_ids = session.scalars(
                select(Video.id).where(Video.status == "ready").order_by(Video.created_at, Video.id)
            ).all()
        elif scope.mode in {"major", "subcategory"}:
            category = session.get(Category, scope.category_id)
            if category is None:
                raise ApiRequestError(404, "category_not_found", "类目不存在。")
            required_level = 1 if scope.mode == "major" else 2
            if category.level != required_level:
                raise ApiRequestError(
                    400,
                    "scope_category_level_mismatch",
                    "启动范围与类目层级不一致。",
                )
            video_ids = _category_video_ids(session, category)
            if scope.video_ids and not set(scope.video_ids).issubset(set(video_ids)):
                raise ApiRequestError(400, "scope_out_of_bounds", "所选视频不属于当前类目。")
        else:
            requested = list(scope.video_ids)
            videos = session.scalars(select(Video).where(Video.id.in_(requested))).all()
            found = {video.id: video for video in videos}
            missing = [video_id for video_id in requested if video_id not in found]
            if missing:
                raise ApiRequestError(404, "scope_video_not_found", "启动范围包含不存在的视频。")
            unavailable = [video_id for video_id in requested if found[video_id].status != "ready"]
            if unavailable:
                raise ApiRequestError(
                    400,
                    "scope_video_not_ready",
                    "启动范围包含尚未完成解析的视频。",
                    retryable=True,
                )
            video_ids = requested
            if scope.category_id is not None:
                category = session.get(Category, scope.category_id)
                if category is None:
                    raise ApiRequestError(404, "category_not_found", "类目不存在。")
                allowed = set(_category_video_ids(session, category))
                if not set(video_ids).issubset(allowed):
                    raise ApiRequestError(400, "scope_out_of_bounds", "所选视频不属于当前类目。")
        ready_ids = set(
            session.scalars(
                select(Video.id).where(Video.id.in_(video_ids), Video.status == "ready")
            ).all()
        ) if video_ids else set()
    result = [video_id for video_id in video_ids if video_id in ready_ids]
    if not result:
        raise ApiRequestError(
            400,
            "empty_collection",
            "当前范围没有可用于编译的已解析视频。",
            retryable=True,
        )
    return result


def _category_video_ids(session: Any, category: Category) -> list[str]:
    category_ids = [category.id]
    if category.level == 1:
        category_ids.extend(
            session.scalars(select(Category.id).where(Category.parent_id == category.id)).all()
        )
    return list(
        dict.fromkeys(
            session.scalars(
                select(CategoryMembership.video_id)
                .join(Video, Video.id == CategoryMembership.video_id)
                .where(
                    CategoryMembership.category_id.in_(category_ids),
                    Video.status == "ready",
                )
                .order_by(Video.created_at, Video.id)
            ).all()
        )
    )


def _build_evidence_catalog(workspace_id: str, bundles: list[Any]) -> list[EvidenceEntry]:
    entries: list[EvidenceEntry] = []
    for bundle in bundles:
        for index, step in enumerate(bundle.tutorial_steps):
            entries.append(
                EvidenceEntry(
                    ref=f"video:{bundle.video_id}:step:{index}",
                    kind="video",
                    source_id=bundle.video_id,
                    evidence_summary=step.text,
                    confidence=step.confidence,
                    start_ms=step.start_ms,
                    end_ms=step.end_ms,
                )
            )
        for index, claim in enumerate(bundle.claims):
            entries.append(
                EvidenceEntry(
                    ref=f"video:{bundle.video_id}:claim:{index}",
                    kind="video",
                    source_id=bundle.video_id,
                    evidence_summary=claim.text,
                    confidence=claim.confidence,
                    start_ms=claim.start_ms,
                    end_ms=claim.end_ms,
                )
            )
    entries.append(
        EvidenceEntry(
            ref="inference:workspace-ordering",
            kind="inference",
            source_id=workspace_id,
            evidence_summary="AI 仅将已引用的视频动作合并并按现场执行顺序排列。",
            confidence=None,
            start_ms=None,
            end_ms=None,
        )
    )
    return entries


def _revision_source_refs(
    database: Database,
    workspace_id: str,
    current_artifact: ArtifactDocument,
    catalog: list[EvidenceEntry],
) -> RevisionSourceRefs:
    """Map persisted provenance IDs to local video-evidence refs without externalizing IDs."""

    catalog_by_identity = {
        (
            entry.kind,
            entry.source_id,
            entry.evidence_summary,
            entry.start_ms,
            entry.end_ms,
        ): entry.ref
        for entry in catalog
        if entry.kind == "video"
    }
    provenance_ids = [
        provenance_id
        for section in current_artifact.sections
        for item in section.items
        for provenance_id in item.provenance_ids
    ]
    provenance_ids.extend(
        provenance_id
        for detail in current_artifact.conflict_details
        for viewpoint in detail.viewpoints
        for provenance_id in viewpoint.provenance_ids
    )
    with database.session() as session:
        provenance_by_id = {
            row.id: row
            for row in session.scalars(
                select(ProvenanceRef).where(
                    ProvenanceRef.id.in_(provenance_ids),
                    ProvenanceRef.workspace_id == workspace_id,
                )
            ).all()
        }

    refs_by_item: dict[str, list[str]] = {}
    for section in current_artifact.sections:
        for item in section.items:
            refs: list[str] = []
            for provenance_id in item.provenance_ids:
                provenance = provenance_by_id.get(provenance_id)
                if provenance is None:
                    raise PipelineError(
                        "artifact_validation_failed",
                        "当前任务卡引用了不存在的来源，无法安全修改。",
                    )
                ref = catalog_by_identity.get(
                    (
                        provenance.kind,
                        provenance.source_id,
                        provenance.evidence_summary,
                        provenance.start_ms,
                        provenance.end_ms,
                    )
                )
                if ref is not None and ref not in refs:
                    refs.append(ref)
            if not refs:
                raise PipelineError(
                    "artifact_validation_failed",
                    "当前行动项没有可匿名映射的视频证据。",
                )
            refs_by_item[item.id] = refs
    conflict_refs: list[list[list[str]]] = []
    for detail in current_artifact.conflict_details:
        detail_refs: list[list[str]] = []
        for viewpoint in detail.viewpoints:
            refs = []
            for provenance_id in viewpoint.provenance_ids:
                provenance = provenance_by_id.get(provenance_id)
                if provenance is None:
                    raise PipelineError(
                        "artifact_validation_failed",
                        "当前冲突观点引用了不存在或越界的来源，无法安全修改。",
                    )
                ref = catalog_by_identity.get(
                    (
                        provenance.kind,
                        provenance.source_id,
                        provenance.evidence_summary,
                        provenance.start_ms,
                        provenance.end_ms,
                    )
                )
                if ref is not None and ref not in refs:
                    refs.append(ref)
            if not refs:
                raise PipelineError(
                    "artifact_validation_failed",
                    "当前冲突观点没有可匿名映射的视频来源。",
                )
            detail_refs.append(refs)
        conflict_refs.append(detail_refs)
    return RevisionSourceRefs(
        item_refs=refs_by_item,
        conflict_viewpoint_refs=conflict_refs,
    )


def _validate_compilation_result(
    draft: Any,
    candidate_video_ids: list[str],
    catalog: list[EvidenceEntry],
    *,
    clarification_used: bool,
    generation_authorized: bool,
) -> None:
    adopted = [item.video_id for item in draft.adopted_videos]
    excluded = [item.video_id for item in draft.excluded_videos]
    if len(set(adopted)) != len(adopted) or len(set(excluded)) != len(excluded):
        raise PipelineError("artifact_validation_failed", "模型返回了重复的视频决策。")
    if set(adopted) & set(excluded) or set(adopted + excluded) != set(candidate_video_ids):
        raise PipelineError(
            "artifact_validation_failed",
            "模型的采用与排除结果没有完整覆盖启动范围。",
        )
    if draft.clarification_question is not None:
        if clarification_used:
            raise PipelineError(
                "clarification_limit_exceeded",
                "模型试图提出第二个问题，已拒绝继续生成。",
            )
        return
    if not generation_authorized:
        raise PipelineError(
            "generation_not_authorized",
            "用户尚未授权生成任务卡，已拒绝发布模型结果。",
        )
    if not adopted:
        raise PipelineError(
            "insufficient_scope_evidence",
            "没有采用任何可支撑任务卡的视频。",
            retryable=True,
        )
    if draft.artifact is None:
        raise PipelineError("artifact_validation_failed", "模型没有返回任务卡。")
    _validate_artifact_sources(draft.artifact, set(adopted), catalog)


def _validate_artifact_sources(
    draft: ArtifactDraft,
    adopted_video_ids: set[str],
    catalog: list[EvidenceEntry],
) -> None:
    catalog_by_ref = {entry.ref: entry for entry in catalog}
    _validate_conflict_sources(draft, adopted_video_ids, catalog_by_ref)
    item_count = 0
    for section in draft.sections:
        for item in section.items:
            item_count += 1
            if len(set(item.source_refs)) != len(item.source_refs):
                raise PipelineError("artifact_validation_failed", "行动项包含重复来源。")
            try:
                sources = [catalog_by_ref[source_ref] for source_ref in item.source_refs]
            except KeyError as exc:
                raise PipelineError(
                    "artifact_validation_failed",
                    "行动项引用了不存在的来源，任务卡未发布。",
                ) from exc
            video_sources = [source for source in sources if source.kind == "video"]
            if not video_sources:
                raise PipelineError(
                    "artifact_validation_failed",
                    "行动项缺少视频证据，任务卡未发布。",
                )
            if any(source.source_id not in adopted_video_ids for source in video_sources):
                raise PipelineError(
                    "artifact_validation_failed",
                    "行动项引用了已排除或越界的视频。",
                )
            _validate_item_semantic_support(
                text=item.text,
                detail=item.detail,
                adjustment_rule=item.adjustment_rule,
                video_sources=video_sources,
            )
    if item_count == 0:
        raise PipelineError("artifact_validation_failed", "任务卡没有可执行行动项。")


def _validate_conflict_sources(
    draft: ArtifactDraft,
    adopted_video_ids: set[str],
    catalog_by_ref: dict[str, EvidenceEntry],
) -> None:
    if bool(draft.conflicts) != bool(draft.conflict_details):
        raise PipelineError(
            "artifact_validation_failed",
            "冲突摘要与逐观点来源必须同时存在，任务卡未发布。",
        )
    used_refs: set[str] = set()
    for detail in draft.conflict_details:
        if not detail.topic.strip() or len(detail.viewpoints) < 2:
            raise PipelineError(
                "artifact_validation_failed",
                "每个冲突必须包含主题和至少两个观点，任务卡未发布。",
            )
        normalized_statements: set[str] = set()
        for viewpoint in detail.viewpoints:
            normalized_statement = _normalize_support_text(viewpoint.statement)
            if not normalized_statement or normalized_statement in normalized_statements:
                raise PipelineError(
                    "artifact_validation_failed",
                    "冲突观点必须非空且彼此不同，任务卡未发布。",
                )
            normalized_statements.add(normalized_statement)
            if not viewpoint.source_refs:
                raise PipelineError(
                    "artifact_validation_failed",
                    "冲突观点缺少来源，任务卡未发布。",
                )
            if len(set(viewpoint.source_refs)) != len(viewpoint.source_refs):
                raise PipelineError(
                    "artifact_validation_failed",
                    "冲突观点包含重复来源，任务卡未发布。",
                )
            if any(source_ref in used_refs for source_ref in viewpoint.source_refs):
                raise PipelineError(
                    "artifact_validation_failed",
                    "同一来源不能重复充当多个冲突观点，任务卡未发布。",
                )
            used_refs.update(viewpoint.source_refs)
            try:
                sources = [catalog_by_ref[source_ref] for source_ref in viewpoint.source_refs]
            except KeyError as exc:
                raise PipelineError(
                    "artifact_validation_failed",
                    "冲突观点引用了不存在的来源，任务卡未发布。",
                ) from exc
            if any(
                source.kind != "video"
                or source.source_id not in adopted_video_ids
                or source.start_ms is None
                or source.end_ms is None
                for source in sources
            ):
                raise PipelineError(
                    "artifact_validation_failed",
                    "冲突观点引用了不可读取、已排除或越界的来源。",
                )
            _validate_statement_semantic_support(
                field_label="冲突观点",
                statement=viewpoint.statement,
                video_sources=sources,
            )


def _validate_item_semantic_support(
    *,
    text: str,
    detail: str | None,
    adjustment_rule: str | None,
    video_sources: list[EvidenceEntry],
) -> None:
    evidence_texts = [source.evidence_summary for source in video_sources]
    for field_label, statement in (
        ("行动项", text),
        ("行动详情", detail),
        ("调节规则", adjustment_rule),
    ):
        if statement is None:
            continue
        if not has_direct_video_support(statement, evidence_texts):
            raise PipelineError(
                "artifact_validation_failed",
                f"{field_label}的证据未直接支持该内容，任务卡未发布。",
            )


def _validate_statement_semantic_support(
    *,
    field_label: str,
    statement: str,
    video_sources: list[EvidenceEntry],
) -> None:
    evidence_texts = [source.evidence_summary for source in video_sources]
    if not has_direct_video_support(statement, evidence_texts):
        raise PipelineError(
            "artifact_validation_failed",
            f"{field_label}的证据未直接支持该内容，任务卡未发布。",
        )


def has_direct_video_support(statement: str, evidence_texts: list[str]) -> bool:
    """Apply the Artifact publication rule to one statement and video evidence set."""

    clauses = [
        clause.strip()
        for clause in _SUPPORT_CLAUSE_SPLIT_RE.split(statement)
        if clause.strip()
    ]
    return bool(clauses) and all(
        _clause_has_direct_video_support(clause, evidence_texts)
        for clause in clauses
    )


def _clause_has_direct_video_support(clause: str, evidence_texts: list[str]) -> bool:
    clause_concepts = _support_concepts(clause)
    evidence_concepts = {
        concept
        for evidence_text in evidence_texts
        for concept in _support_concepts(evidence_text)
    }
    if clause_concepts:
        return clause_concepts <= evidence_concepts

    normalized_clause = _normalize_support_text(clause)
    if len(normalized_clause) < 4:
        return False
    return any(
        normalized_clause in normalized_evidence
        or (
            len(normalized_evidence) >= 4
            and normalized_evidence in normalized_clause
        )
        for normalized_evidence in map(_normalize_support_text, evidence_texts)
    )


def _support_concepts(text: str) -> set[str]:
    normalized = text.casefold()
    return {
        concept
        for concept, keywords in _DIRECT_SUPPORT_CONCEPTS.items()
        if any(keyword in normalized for keyword in keywords)
    }


def _normalize_support_text(text: str) -> str:
    return _SUPPORT_TEXT_NORMALIZE_RE.sub("", text.casefold())


def _replace_video_decisions(session: Any, workspace_id: str, draft: Any) -> None:
    session.execute(delete(WorkspaceSource).where(WorkspaceSource.workspace_id == workspace_id))
    for decision in draft.adopted_videos:
        session.add(
            WorkspaceSource(
                workspace_id=workspace_id,
                video_id=decision.video_id,
                decision="adopted",
                reason=decision.reason,
            )
        )
    for decision in draft.excluded_videos:
        session.add(
            WorkspaceSource(
                workspace_id=workspace_id,
                video_id=decision.video_id,
                decision="excluded",
                reason=decision.reason,
            )
        )


def _persist_artifact(
    session: Any,
    workspace: Workspace,
    draft: ArtifactDraft,
    catalog: list[EvidenceEntry],
    *,
    job_id: str,
    instruction: str | None,
) -> ArtifactDocument:
    artifact = (
        session.get(Artifact, workspace.current_artifact_id)
        if workspace.current_artifact_id
        else None
    )
    if instruction is None and artifact is not None:
        raise PipelineError("artifact_already_exists", "工作区已经存在 Artifact。")
    checked_by_identity: dict[tuple[str, str], tuple[str, bool]] = {}
    if artifact is None:
        artifact = Artifact(
            workspace_id=workspace.id,
            kind="shooting_task_card",
            title=draft.title,
            purpose=draft.purpose,
            conflicts_json=list(draft.conflicts),
            conflict_details_json=[],
            uncertainties_json=list(draft.uncertainties),
            compact_variant_json=(
                draft.compact_variant.model_dump(mode="json")
                if draft.compact_variant is not None
                else None
            ),
            version=1,
        )
        session.add(artifact)
        session.flush()
    else:
        old_rows = session.execute(
            select(ArtifactItemRecord, ArtifactSectionRecord.title)
            .join(ArtifactSectionRecord, ArtifactSectionRecord.id == ArtifactItemRecord.section_id)
            .where(ArtifactItemRecord.artifact_id == artifact.id)
        ).all()
        checked_by_identity = {
            (section_title, item.text): (item.id, item.checked)
            for item, section_title in old_rows
        }
        old_item_ids = [item.id for item, _ in old_rows]
        if old_item_ids:
            session.execute(
                delete(ArtifactItemProvenance).where(
                    ArtifactItemProvenance.item_id.in_(old_item_ids)
                )
            )
            session.execute(
                delete(ArtifactItemRecord).where(ArtifactItemRecord.id.in_(old_item_ids))
            )
        session.execute(
            delete(ArtifactSectionRecord).where(ArtifactSectionRecord.artifact_id == artifact.id)
        )
        artifact.title = draft.title
        artifact.purpose = draft.purpose
        artifact.conflicts_json = list(draft.conflicts)
        artifact.conflict_details_json = []
        artifact.uncertainties_json = list(draft.uncertainties)
        artifact.compact_variant_json = (
            draft.compact_variant.model_dump(mode="json")
            if draft.compact_variant is not None
            else None
        )
        artifact.version += 1
        artifact.updated_at = utc_now()
        session.flush()

    catalog_by_ref = {entry.ref: entry for entry in catalog}
    provenance_by_ref: dict[str, ProvenanceRef] = {}
    for section_draft in sorted(draft.sections, key=lambda value: value.order):
        section = ArtifactSectionRecord(
            artifact_id=artifact.id,
            title=section_draft.title,
            sort_order=section_draft.order,
        )
        session.add(section)
        session.flush()
        for item_order, item_draft in enumerate(section_draft.items):
            identity = (section_draft.title, item_draft.text)
            prior_id, prior_checked = checked_by_identity.get(identity, (new_id(), False))
            item = ArtifactItemRecord(
                id=prior_id,
                artifact_id=artifact.id,
                section_id=section.id,
                text=item_draft.text,
                detail=item_draft.detail,
                checked=prior_checked,
                adjustment_rule=item_draft.adjustment_rule,
                sort_order=item_order,
            )
            session.add(item)
            session.flush()
            for source_ref in item_draft.source_refs:
                entry = catalog_by_ref[source_ref]
                provenance = provenance_by_ref.get(source_ref)
                if provenance is None:
                    provenance = _get_or_create_provenance(session, workspace.id, entry)
                    provenance_by_ref[source_ref] = provenance
                session.add(
                    ArtifactItemProvenance(item_id=item.id, provenance_id=provenance.id)
                )

    artifact.conflict_details_json = _persist_conflict_details(
        session,
        workspace.id,
        draft,
        catalog_by_ref,
        provenance_by_ref,
    )
    workspace.current_artifact_id = artifact.id
    session.flush()
    document = _artifact_document(session, artifact)
    session.add(
        ArtifactVersion(
            artifact_id=artifact.id,
            version=artifact.version,
            document_json=document.model_dump(mode="json"),
            instruction=instruction,
            job_id=job_id,
        )
    )
    session.flush()
    return document


def _persist_conflict_details(
    session: Any,
    workspace_id: str,
    draft: ArtifactDraft,
    catalog_by_ref: dict[str, EvidenceEntry],
    provenance_by_ref: dict[str, ProvenanceRef],
) -> list[dict[str, Any]]:
    documents: list[dict[str, Any]] = []
    for detail in draft.conflict_details:
        viewpoints: list[ArtifactConflictViewpoint] = []
        for viewpoint in detail.viewpoints:
            provenance_ids: list[str] = []
            for source_ref in viewpoint.source_refs:
                entry = catalog_by_ref[source_ref]
                provenance = provenance_by_ref.get(source_ref)
                if provenance is None:
                    provenance = _get_or_create_provenance(session, workspace_id, entry)
                    provenance_by_ref[source_ref] = provenance
                provenance_ids.append(provenance.id)
            viewpoints.append(
                ArtifactConflictViewpoint(
                    statement=viewpoint.statement,
                    provenance_ids=provenance_ids,
                )
            )
        documents.append(
            ArtifactConflictDetail(
                topic=detail.topic,
                viewpoints=viewpoints,
                resolution=detail.resolution,
            ).model_dump(mode="json")
        )
    return documents


def _get_or_create_provenance(
    session: Any,
    workspace_id: str,
    entry: EvidenceEntry,
) -> ProvenanceRef:
    existing = session.scalar(
        select(ProvenanceRef).where(
            ProvenanceRef.workspace_id == workspace_id,
            ProvenanceRef.kind == entry.kind,
            ProvenanceRef.source_id == entry.source_id,
            ProvenanceRef.evidence_summary == entry.evidence_summary,
            ProvenanceRef.start_ms == entry.start_ms,
            ProvenanceRef.end_ms == entry.end_ms,
        )
    )
    if existing is not None:
        return existing
    if entry.kind == "video":
        video = session.get(Video, entry.source_id)
        if video is None or entry.start_ms is None or entry.end_ms is None:
            raise PipelineError("artifact_validation_failed", "视频来源不完整。")
        if video.duration_ms is not None and entry.end_ms > video.duration_ms:
            raise PipelineError("artifact_validation_failed", "视频来源时间点超出视频时长。")
    provenance = ProvenanceRef(
        workspace_id=workspace_id,
        kind=entry.kind,
        source_id=entry.source_id,
        evidence_summary=entry.evidence_summary,
        confidence=entry.confidence,
        start_ms=entry.start_ms,
        end_ms=entry.end_ms,
        retrieved_at=None,
    )
    session.add(provenance)
    session.flush()
    return provenance


def _artifact_document(session: Any, artifact: Artifact) -> ArtifactDocument:
    sections = session.scalars(
        select(ArtifactSectionRecord)
        .where(ArtifactSectionRecord.artifact_id == artifact.id)
        .order_by(ArtifactSectionRecord.sort_order)
    ).all()
    section_documents: list[ArtifactSection] = []
    for section in sections:
        items = session.scalars(
            select(ArtifactItemRecord)
            .where(ArtifactItemRecord.section_id == section.id)
            .order_by(ArtifactItemRecord.sort_order)
        ).all()
        section_documents.append(
            ArtifactSection(
                id=section.id,
                title=section.title,
                order=section.sort_order,
                items=[
                    ArtifactItem(
                        id=item.id,
                        text=item.text,
                        detail=item.detail,
                        checked=item.checked,
                        adjustment_rule=item.adjustment_rule,
                        provenance_ids=list(
                            session.scalars(
                                select(ArtifactItemProvenance.provenance_id)
                                .where(ArtifactItemProvenance.item_id == item.id)
                                .order_by(ArtifactItemProvenance.provenance_id)
                            ).all()
                        ),
                    )
                    for item in items
                ],
            )
        )
    compact = (
        ArtifactCompactVariant.model_validate(artifact.compact_variant_json)
        if artifact.compact_variant_json is not None
        else None
    )
    return ArtifactDocument(
        id=artifact.id,
        kind=artifact.kind,
        title=artifact.title,
        purpose=artifact.purpose,
        sections=section_documents,
        conflicts=list(artifact.conflicts_json or []),
        conflict_details=[
            ArtifactConflictDetail.model_validate(value)
            for value in (artifact.conflict_details_json or [])
        ],
        uncertainties=list(artifact.uncertainties_json or []),
        compact_variant=compact,
        version=artifact.version,
        created_at=_aware(artifact.created_at),
        updated_at=_aware(artifact.updated_at),
    )


def _job_card(session: Any, job_id: str) -> JobCard | None:
    job = session.get(Job, job_id)
    if job is None:
        return None
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
            str(job.payload_json.get("video_id")) if job.payload_json.get("video_id") else None
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
            if latest is not None
            else None
        ),
    )


def _mark_workspace_failed(database: Database, workspace_id: str, message: str) -> None:
    with database.session() as session:
        workspace = session.get(Workspace, workspace_id)
        if workspace is None:
            return
        workspace.state = "failed"
        session.add(
            WorkspaceMessage(
                workspace_id=workspace.id,
                role="system_event",
                content=message,
            )
        )
        session.commit()


def _public_error_message(exc: Exception) -> str:
    if isinstance(exc, PipelineError):
        return f"生成失败：{exc.message}"
    return f"生成失败：后台任务出现未预期错误（{type(exc).__name__}）。"


def _goal_authorizes_generation(goal: str) -> bool:
    markers = ("生成", "做成", "变成", "整理成", "任务卡", "清单", "小纸条")
    return any(marker in goal for marker in markers)


def _initial_title(goal: str) -> str:
    normalized = " ".join(goal.split())
    return normalized[:32] if len(normalized) <= 32 else f"{normalized[:29]}…"


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)
