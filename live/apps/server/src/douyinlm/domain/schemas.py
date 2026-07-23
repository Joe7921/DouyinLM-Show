from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ComponentHealth(BaseModel):
    ok: bool
    detail: str


class ReadyHealth(BaseModel):
    status: Literal["ready", "not_ready"]
    mode: str
    database: ComponentHealth
    filesystem: ComponentHealth
    job_runner: ComponentHealth


class ProviderStatus(BaseModel):
    configured: bool
    required_from_gate: str
    detail: str | None = None


class ProvidersHealth(BaseModel):
    ark: ProviderStatus
    asr: ProviderStatus
    ffmpeg: ProviderStatus
    web_search_enabled: bool


class TimedText(StrictModel):
    text: str = Field(min_length=1)
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)
    confidence: float | None = Field(default=None, ge=0, le=1)

    @field_validator("text")
    @classmethod
    def validate_meaningful_text(cls, value: str) -> str:
        normalized = value.strip()
        if not any(character.isalnum() for character in normalized):
            raise ValueError("text must contain a letter or number")
        return normalized

    @model_validator(mode="after")
    def validate_range(self) -> TimedText:
        if self.end_ms < self.start_ms:
            raise ValueError("end_ms must be greater than or equal to start_ms")
        return self


class TutorialStep(TimedText):
    detail: str | None = None


class EvidenceClaim(TimedText):
    evidence: Literal["transcript", "frame", "multimodal"]
    confidence: float = Field(ge=0, le=1)


class VideoUnderstandingDraft(StrictModel):
    purpose_line: str = Field(min_length=6, max_length=120)
    summary: str = Field(min_length=10, max_length=1200)
    content_types: list[str] = Field(default_factory=list, max_length=12)
    scenes: list[str] = Field(default_factory=list, max_length=12)
    equipment: list[str] = Field(default_factory=list, max_length=20)
    conditions: list[str] = Field(default_factory=list, max_length=20)
    tutorial_steps: list[TutorialStep] = Field(default_factory=list, max_length=30)
    claims: list[EvidenceClaim] = Field(default_factory=list, max_length=40)
    visible_text: list[TimedText] = Field(default_factory=list, max_length=40)
    uncertainties: list[str] = Field(default_factory=list, max_length=20)


class VideoUnderstandingBundle(VideoUnderstandingDraft):
    video_id: str
    source_hash: str
    title: str
    author: str | None = None
    source_url: str | None = None
    model_run_id: str
    schema_version: str


class TaxonomySubcategoryDraft(StrictModel):
    key: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{1,63}$")
    name: str = Field(min_length=2, max_length=40)
    purpose: str = Field(min_length=4, max_length=160)
    video_ids: list[str] = Field(min_length=1)


class TaxonomyMajorDraft(StrictModel):
    key: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{1,63}$")
    name: str = Field(min_length=2, max_length=40)
    purpose: str = Field(min_length=4, max_length=160)
    subcategories: list[TaxonomySubcategoryDraft] = Field(min_length=1, max_length=8)


class TaxonomyMembershipDraft(StrictModel):
    video_id: str
    subcategory_key: str
    reason: str = Field(min_length=4, max_length=240)
    confidence: float = Field(ge=0, le=1)


class TaxonomyDraft(StrictModel):
    major_categories: list[TaxonomyMajorDraft] = Field(min_length=1, max_length=8)
    memberships: list[TaxonomyMembershipDraft] = Field(min_length=1)


class VideoCard(BaseModel):
    id: str
    title: str
    author: str | None
    source_url: str | None = None
    status: Literal[
        "queued",
        "processing",
        "transcribing",
        "classifying",
        "ready",
        "needs_configuration",
        "failed",
    ]
    purpose_line: str | None = None
    summary: str | None = None
    content_types: list[str]
    duration_ms: int | None = None
    thumbnail_url: str | None = None
    current_job_id: str | None = None
    error_code: str | None = None
    error_message: str | None = None


class SubcategoryCard(BaseModel):
    id: str
    name: str
    purpose: str
    video_count: int


class CategoryCard(BaseModel):
    id: str
    name: str
    purpose: str
    video_count: int
    subcategories: list[SubcategoryCard] = Field(default_factory=list)


WorkspaceState = Literal["forming", "clarifying", "compiling", "ready", "failed"]
JobStatus = Literal["queued", "running", "completed", "failed", "blocked"]


class WorkspaceCard(BaseModel):
    id: str
    title: str
    state: WorkspaceState
    updated_at: datetime


class CollectionResponse(BaseModel):
    is_demo_data: bool = True
    notice: str
    videos: list[VideoCard] = Field(default_factory=list)
    categories: list[CategoryCard] = Field(default_factory=list)
    recent_workspaces: list[WorkspaceCard] = Field(default_factory=list)


class ImportManifestEntry(StrictModel):
    filename: str
    title: str | None = None
    author: str | None = None
    source_url: str | None = None
    permission_scope: str | None = None
    permission_evidence_path: str | None = None


class ImportManifest(StrictModel):
    schema_version: int = 1
    videos: list[ImportManifestEntry] = Field(default_factory=list)


class ImportedVideo(BaseModel):
    video_id: str
    job_id: str | None
    filename: str
    duplicate: bool


class ImportResponse(BaseModel):
    items: list[ImportedVideo]


class JobEventCard(BaseModel):
    sequence: int
    stage: str
    progress: int
    message: str
    created_at: datetime


class JobCard(BaseModel):
    id: str
    kind: str
    status: JobStatus
    video_id: str | None = None
    attempts: int
    last_error: str | None = None
    created_at: datetime
    updated_at: datetime
    latest_event: JobEventCard | None = None


class JobListResponse(BaseModel):
    jobs: list[JobCard]


class ApiError(BaseModel):
    code: str
    message: str
    retryable: bool = False
    job_id: str | None = None


LaunchMode = Literal["home", "major", "subcategory", "selected", "single"]
ScopeExpansionTarget = Literal["parent", "home"]


class LaunchScope(StrictModel):
    mode: LaunchMode
    category_id: str | None
    video_ids: list[str]

    @field_validator("video_ids")
    @classmethod
    def validate_unique_video_ids(cls, value: list[str]) -> list[str]:
        normalized = [item.strip() for item in value]
        if any(not item for item in normalized):
            raise ValueError("video_ids must not contain blank values")
        if len(set(normalized)) != len(normalized):
            raise ValueError("video_ids must be unique")
        return normalized

    @model_validator(mode="after")
    def validate_mode(self) -> LaunchScope:
        if self.mode == "home" and (self.category_id is not None or self.video_ids):
            raise ValueError("home scope requires category_id=null and video_ids=[]")
        if self.mode in {"major", "subcategory"} and self.category_id is None:
            raise ValueError(f"{self.mode} scope requires category_id")
        if self.mode == "single" and len(self.video_ids) != 1:
            raise ValueError("single scope requires exactly one video_id")
        if self.mode == "selected" and len(self.video_ids) < 2:
            raise ValueError("selected scope requires at least two video_ids")
        return self


class CreateWorkspaceRequest(StrictModel):
    goal: str = Field(min_length=1, max_length=2000)
    launch_scope: LaunchScope

    @field_validator("goal")
    @classmethod
    def normalize_goal(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("goal must not be blank")
        return normalized


class AsyncWorkspaceResponse(StrictModel):
    workspace_id: str
    job_id: str
    state: WorkspaceState


class ExpandWorkspaceScopeRequest(StrictModel):
    target: ScopeExpansionTarget


class SendMessageRequest(StrictModel):
    text: str = Field(min_length=1, max_length=2000)

    @field_validator("text")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("text must not be blank")
        return normalized


class AdoptedVideo(StrictModel):
    video_id: str = Field(min_length=1)
    reason: str = Field(min_length=1)


class ExcludedVideo(StrictModel):
    video_id: str = Field(min_length=1)
    reason: str = Field(min_length=1)


class WorkspaceMessage(StrictModel):
    id: str
    role: Literal["user", "assistant", "system_event"]
    content: str = Field(min_length=1)
    created_at: datetime


class ScopeExpansionOption(StrictModel):
    target: ScopeExpansionTarget
    label: str = Field(min_length=1)
    candidate_count: int = Field(ge=1)


class ArtifactItem(StrictModel):
    id: str
    text: str = Field(min_length=1)
    detail: str | None
    checked: bool
    adjustment_rule: str | None
    provenance_ids: list[str] = Field(min_length=1)

    @field_validator("provenance_ids")
    @classmethod
    def validate_unique_provenance_ids(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("provenance_ids must be unique")
        return value


class ArtifactSection(StrictModel):
    id: str
    title: str = Field(min_length=1)
    order: int = Field(ge=0)
    items: list[ArtifactItem]


class ArtifactCompactVariant(StrictModel):
    title: str = Field(min_length=1)
    lines: list[str] = Field(min_length=1, max_length=8)


class ArtifactConflictViewpoint(StrictModel):
    statement: str = Field(min_length=1)
    provenance_ids: list[str] = Field(
        min_length=1,
        json_schema_extra={"uniqueItems": True},
    )

    @field_validator("statement")
    @classmethod
    def normalize_statement(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("statement must not be blank")
        return normalized

    @field_validator("provenance_ids")
    @classmethod
    def validate_provenance_ids(cls, value: list[str]) -> list[str]:
        normalized = [item.strip() for item in value]
        if any(not item for item in normalized):
            raise ValueError("provenance_ids must not contain blank values")
        if len(set(normalized)) != len(normalized):
            raise ValueError("provenance_ids must be unique")
        return normalized


class ArtifactConflictDetail(StrictModel):
    topic: str = Field(min_length=1)
    viewpoints: list[ArtifactConflictViewpoint] = Field(min_length=2)
    resolution: str | None

    @field_validator("topic")
    @classmethod
    def normalize_topic(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("topic must not be blank")
        return normalized

    @field_validator("resolution")
    @classmethod
    def normalize_resolution(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("resolution must be null or non-blank")
        return normalized


class ArtifactDocument(StrictModel):
    id: str
    kind: Literal["shooting_task_card"]
    title: str = Field(min_length=1)
    purpose: str = Field(min_length=1)
    sections: list[ArtifactSection]
    conflicts: list[str]
    conflict_details: list[ArtifactConflictDetail]
    uncertainties: list[str]
    compact_variant: ArtifactCompactVariant | None
    version: int = Field(ge=1)
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="before")
    @classmethod
    def default_legacy_conflict_details(cls, value: object) -> object:
        if isinstance(value, dict) and "conflict_details" not in value:
            normalized = dict(value)
            normalized["conflict_details"] = []
            return normalized
        return value

    @model_validator(mode="after")
    def validate_shooting_sections(self) -> ArtifactDocument:
        ordered = sorted(self.sections, key=lambda section: section.order)
        expected = [(0, "拍摄前"), (1, "到场后"), (2, "拍完后")]
        actual = [(section.order, section.title) for section in ordered]
        if actual != expected:
            raise ValueError("shooting task card requires 拍摄前、到场后、拍完后")
        section_ids = [section.id for section in self.sections]
        item_ids = [item.id for section in self.sections for item in section.items]
        if len(set(section_ids)) != len(section_ids):
            raise ValueError("section ids must be unique")
        if len(set(item_ids)) != len(item_ids):
            raise ValueError("artifact item ids must be unique")
        return self


class WorkspaceDetail(StrictModel):
    id: str
    generated_title: str = Field(min_length=1)
    original_goal: str = Field(min_length=1)
    launch_scope: LaunchScope
    state: WorkspaceState
    adopted_videos: list[AdoptedVideo]
    excluded_videos: list[ExcludedVideo]
    confirmed_constraints: list[str]
    messages: list[WorkspaceMessage]
    scope_expansion_options: list[ScopeExpansionOption]
    active_job: JobCard | None
    artifact: ArtifactDocument | None
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def validate_video_decisions(self) -> WorkspaceDetail:
        adopted = [item.video_id for item in self.adopted_videos]
        excluded = [item.video_id for item in self.excluded_videos]
        if len(set(adopted)) != len(adopted) or len(set(excluded)) != len(excluded):
            raise ValueError("video decisions must be unique")
        if set(adopted) & set(excluded):
            raise ValueError("adopted and excluded videos must not overlap")
        return self


class ReviseArtifactRequest(StrictModel):
    instruction: str = Field(min_length=1, max_length=2000)

    @field_validator("instruction")
    @classmethod
    def normalize_instruction(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("instruction must not be blank")
        return normalized


class ReviseArtifactResponse(StrictModel):
    artifact_id: str
    job_id: str
    version_before: int = Field(ge=1)


class CheckArtifactItemRequest(StrictModel):
    checked: bool


class CheckArtifactItemResponse(StrictModel):
    artifact_id: str
    item_id: str
    checked: bool
    updated_at: datetime


class VideoProvenanceView(StrictModel):
    title: str = Field(min_length=1)
    author: str | None
    thumbnail_url: str | None
    playback_url: str | None
    source_url: str | None


class WebProvenanceView(StrictModel):
    title: str = Field(min_length=1)
    url: str = Field(min_length=1)
    publisher: str | None


class ProvenanceDetail(StrictModel):
    id: str
    kind: Literal["video", "web", "inference"]
    source_id: str = Field(min_length=1)
    evidence_summary: str = Field(min_length=1)
    confidence: float | None = Field(default=None, ge=0, le=1)
    start_ms: int | None = Field(default=None, ge=0)
    end_ms: int | None = Field(default=None, ge=0)
    retrieved_at: datetime | None
    video: VideoProvenanceView | None
    web: WebProvenanceView | None

    @model_validator(mode="after")
    def validate_source_shape(self) -> ProvenanceDetail:
        if self.start_ms is not None and self.end_ms is not None and self.end_ms < self.start_ms:
            raise ValueError("end_ms must be greater than or equal to start_ms")
        if self.kind == "video":
            if (
                self.video is None
                or self.web is not None
                or self.start_ms is None
                or self.end_ms is None
            ):
                raise ValueError("video provenance requires video and a time range only")
        elif self.kind == "web":
            if self.web is None or self.video is not None or self.retrieved_at is None:
                raise ValueError("web provenance requires web and retrieved_at only")
        elif self.video is not None or self.web is not None:
            raise ValueError("inference provenance must not claim an external source view")
        return self


class CategoryDetail(StrictModel):
    id: str
    parent_id: str | None
    level: Literal[1, 2]
    name: str = Field(min_length=1)
    purpose: str = Field(min_length=1)
    videos: list[VideoCard]
    subcategories: list[SubcategoryCard]


# The following drafts are provider-only schemas. They deliberately reference evidence catalog
# keys instead of accepting model-authored provenance records.
class VideoDecisionDraft(StrictModel):
    video_id: str = Field(min_length=1)
    reason: str = Field(min_length=1, max_length=300)


class ArtifactItemDraft(StrictModel):
    text: str = Field(min_length=1, max_length=300)
    detail: str | None
    adjustment_rule: str | None
    source_refs: list[str] = Field(min_length=1, max_length=12)


class ArtifactSectionDraft(StrictModel):
    title: Literal["拍摄前", "到场后", "拍完后"]
    order: Literal[0, 1, 2]
    items: list[ArtifactItemDraft]


class ArtifactConflictViewpointDraft(StrictModel):
    statement: str = Field(min_length=1, max_length=500)
    source_refs: list[str] = Field(
        min_length=1,
        max_length=12,
        json_schema_extra={"uniqueItems": True},
    )

    @field_validator("statement")
    @classmethod
    def normalize_statement(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("statement must not be blank")
        return normalized

    @field_validator("source_refs")
    @classmethod
    def validate_source_refs(cls, value: list[str]) -> list[str]:
        normalized = [item.strip() for item in value]
        if any(not item for item in normalized):
            raise ValueError("source_refs must not contain blank values")
        if len(set(normalized)) != len(normalized):
            raise ValueError("source_refs must be unique")
        return normalized


class ArtifactConflictDetailDraft(StrictModel):
    topic: str = Field(min_length=1, max_length=300)
    viewpoints: list[ArtifactConflictViewpointDraft] = Field(min_length=2, max_length=12)
    resolution: str | None = Field(max_length=500)

    @field_validator("topic")
    @classmethod
    def normalize_topic(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("topic must not be blank")
        return normalized

    @field_validator("resolution")
    @classmethod
    def normalize_resolution(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("resolution must be null or non-blank")
        return normalized


class ArtifactDraft(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    purpose: str = Field(min_length=1, max_length=500)
    sections: list[ArtifactSectionDraft] = Field(min_length=3, max_length=3)
    conflicts: list[str] = Field(max_length=20)
    conflict_details: list[ArtifactConflictDetailDraft] = Field(max_length=20)
    uncertainties: list[str] = Field(max_length=20)
    compact_variant: ArtifactCompactVariant | None

    @model_validator(mode="after")
    def validate_sections(self) -> ArtifactDraft:
        ordered = sorted(self.sections, key=lambda section: section.order)
        expected = [(0, "拍摄前"), (1, "到场后"), (2, "拍完后")]
        if [(section.order, section.title) for section in ordered] != expected:
            raise ValueError("artifact draft must contain the three shooting stages")
        if bool(self.conflicts) != bool(self.conflict_details):
            raise ValueError("conflicts and conflict_details must be declared together")
        return self


class WorkspaceCompilationDraft(StrictModel):
    generated_title: str = Field(min_length=1, max_length=200)
    adopted_videos: list[VideoDecisionDraft]
    excluded_videos: list[VideoDecisionDraft]
    confirmed_constraints: list[str]
    clarification_question: str | None
    clarification_reason: str | None
    artifact: ArtifactDraft | None

    @model_validator(mode="before")
    @classmethod
    def prefer_authorized_artifact_over_redundant_question(cls, value: object) -> object:
        if isinstance(value, dict) and value.get("artifact") is not None:
            normalized = dict(value)
            normalized["clarification_question"] = None
            normalized["clarification_reason"] = None
            return normalized
        return value

    @field_validator("clarification_question", "clarification_reason", mode="before")
    @classmethod
    def normalize_optional_clarification_text(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @model_validator(mode="after")
    def validate_outcome(self) -> WorkspaceCompilationDraft:
        asking = self.clarification_question is not None
        if asking == (self.artifact is not None):
            raise ValueError("return exactly one of clarification_question or artifact")
        if asking and self.clarification_reason is None:
            raise ValueError("clarification_reason is required with a question")
        return self


class CompilerConversationMessage(StrictModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=2000)


class CompilerToolPolicy(StrictModel):
    allow_web_search: bool
    generation_authorized: bool


class RunCompilerRequest(StrictModel):
    scope: LaunchScope
    goal: str = Field(min_length=1, max_length=2000)
    conversation: list[CompilerConversationMessage]
    tool_policy: CompilerToolPolicy

    @field_validator("goal")
    @classmethod
    def normalize_run_goal(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("goal must not be blank")
        return normalized


class RunCompilerResponse(StrictModel):
    workspace_id: str
    job_id: str
