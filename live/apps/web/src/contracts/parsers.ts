import type {
  ArtifactCompactVariant,
  ArtifactConflictDetail,
  ArtifactConflictViewpoint,
  ArtifactDocument,
  ArtifactItem,
  ArtifactSection,
  AsyncWorkspaceResponse,
  CategoryCard,
  CategoryDetail,
  CheckArtifactItemResponse,
  CollectionResponse,
  ComponentHealth,
  ImportResponse,
  JobCard,
  JobEventCard,
  JobListResponse,
  LaunchScope,
  ProviderStatus,
  ProvidersHealth,
  ProvenanceDetail,
  ReadyHealth,
  ReviseArtifactResponse,
  SubcategoryCard,
  VideoCard,
  VideoProvenanceView,
  WebProvenanceView,
  WorkspaceCard,
  WorkspaceDetail,
  WorkspaceMessage,
} from ".";

type JsonObject = Record<string, unknown>;

export class ContractParseError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "ContractParseError";
    this.path = path;
  }
}

const VIDEO_STATUSES = [
  "queued",
  "processing",
  "transcribing",
  "classifying",
  "ready",
  "needs_configuration",
  "failed",
] as const;
const JOB_STATUSES = ["queued", "running", "completed", "failed", "blocked"] as const;
const WORKSPACE_STATES = ["forming", "clarifying", "compiling", "ready", "failed"] as const;
const LAUNCH_MODES = ["home", "major", "subcategory", "selected", "single"] as const;
const MESSAGE_ROLES = ["user", "assistant", "system_event"] as const;
const PROVENANCE_KINDS = ["video", "web", "inference"] as const;

function objectAt(value: unknown, path: string, keys: readonly string[]): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContractParseError(path, "expected object");
  }
  const result = value as JsonObject;
  const extras = Object.keys(result).filter((key) => !keys.includes(key));
  const missing = keys.filter((key) => !(key in result));
  if (extras.length) throw new ContractParseError(path, `unexpected keys: ${extras.join(", ")}`);
  if (missing.length) throw new ContractParseError(path, `missing keys: ${missing.join(", ")}`);
  return result;
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== "string") throw new ContractParseError(path, "expected string");
  return value;
}

function nonEmptyStringAt(value: unknown, path: string): string {
  const result = stringAt(value, path);
  if (!result.trim()) throw new ContractParseError(path, "must not be empty");
  return result;
}

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new ContractParseError(path, "expected boolean");
  return value;
}

function numberAt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ContractParseError(path, "expected finite number");
  }
  return value;
}

function integerAt(value: unknown, path: string, minimum = Number.MIN_SAFE_INTEGER): number {
  const result = numberAt(value, path);
  if (!Number.isInteger(result) || result < minimum) {
    throw new ContractParseError(path, `expected integer >= ${minimum}`);
  }
  return result;
}

function confidenceAt(value: unknown, path: string): number {
  const result = numberAt(value, path);
  if (result < 0 || result > 1) throw new ContractParseError(path, "expected number in [0, 1]");
  return result;
}

function timestampAt(value: unknown, path: string): string {
  const result = nonEmptyStringAt(value, path);
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(result) || Number.isNaN(Date.parse(result))) {
    throw new ContractParseError(path, "expected timezone-aware ISO 8601 timestamp");
  }
  return result;
}

function nullableAt<T>(value: unknown, path: string, parser: (item: unknown, itemPath: string) => T): T | null {
  return value === null ? null : parser(value, path);
}

function arrayAt<T>(value: unknown, path: string, parser: (item: unknown, itemPath: string) => T): T[] {
  if (!Array.isArray(value)) throw new ContractParseError(path, "expected array");
  return value.map((item, index) => parser(item, `${path}[${index}]`));
}

function enumAt<const T extends readonly string[]>(value: unknown, path: string, values: T): T[number] {
  const result = stringAt(value, path);
  if (!values.includes(result)) {
    throw new ContractParseError(path, `expected one of: ${values.join(", ")}`);
  }
  return result as T[number];
}

function uniqueIdsAt(ids: string[], path: string): string[] {
  if (new Set(ids).size !== ids.length) throw new ContractParseError(path, "IDs must be unique");
  return ids;
}

function componentHealthAt(value: unknown, path: string): ComponentHealth {
  const item = objectAt(value, path, ["ok", "detail"]);
  return { ok: booleanAt(item.ok, `${path}.ok`), detail: stringAt(item.detail, `${path}.detail`) };
}

function providerStatusAt(value: unknown, path: string): ProviderStatus {
  const item = objectAt(value, path, ["configured", "required_from_gate", "detail"]);
  return {
    configured: booleanAt(item.configured, `${path}.configured`),
    required_from_gate: nonEmptyStringAt(item.required_from_gate, `${path}.required_from_gate`),
    detail: nullableAt(item.detail, `${path}.detail`, stringAt),
  };
}

function subcategoryCardAt(value: unknown, path: string): SubcategoryCard {
  const item = objectAt(value, path, ["id", "name", "purpose", "video_count"]);
  return {
    id: nonEmptyStringAt(item.id, `${path}.id`),
    name: nonEmptyStringAt(item.name, `${path}.name`),
    purpose: nonEmptyStringAt(item.purpose, `${path}.purpose`),
    video_count: integerAt(item.video_count, `${path}.video_count`, 0),
  };
}

function categoryCardAt(value: unknown, path: string): CategoryCard {
  const item = objectAt(value, path, ["id", "name", "purpose", "video_count", "subcategories"]);
  return {
    id: nonEmptyStringAt(item.id, `${path}.id`),
    name: nonEmptyStringAt(item.name, `${path}.name`),
    purpose: nonEmptyStringAt(item.purpose, `${path}.purpose`),
    video_count: integerAt(item.video_count, `${path}.video_count`, 0),
    subcategories: arrayAt(item.subcategories, `${path}.subcategories`, subcategoryCardAt),
  };
}

function videoCardAt(value: unknown, path: string): VideoCard {
  const item = objectAt(value, path, [
    "id",
    "title",
    "author",
    "source_url",
    "status",
    "purpose_line",
    "summary",
    "content_types",
    "duration_ms",
    "thumbnail_url",
    "current_job_id",
    "error_code",
    "error_message",
  ]);
  return {
    id: nonEmptyStringAt(item.id, `${path}.id`),
    title: nonEmptyStringAt(item.title, `${path}.title`),
    author: nullableAt(item.author, `${path}.author`, stringAt),
    source_url: nullableAt(item.source_url, `${path}.source_url`, stringAt),
    status: enumAt(item.status, `${path}.status`, VIDEO_STATUSES),
    purpose_line: nullableAt(item.purpose_line, `${path}.purpose_line`, stringAt),
    summary: nullableAt(item.summary, `${path}.summary`, stringAt),
    content_types: arrayAt(item.content_types, `${path}.content_types`, nonEmptyStringAt),
    duration_ms: nullableAt(item.duration_ms, `${path}.duration_ms`, (entry, entryPath) => integerAt(entry, entryPath, 0)),
    thumbnail_url: nullableAt(item.thumbnail_url, `${path}.thumbnail_url`, stringAt),
    current_job_id: nullableAt(item.current_job_id, `${path}.current_job_id`, stringAt),
    error_code: nullableAt(item.error_code, `${path}.error_code`, stringAt),
    error_message: nullableAt(item.error_message, `${path}.error_message`, stringAt),
  };
}

function workspaceCardAt(value: unknown, path: string): WorkspaceCard {
  const item = objectAt(value, path, ["id", "title", "state", "updated_at"]);
  return {
    id: nonEmptyStringAt(item.id, `${path}.id`),
    title: nonEmptyStringAt(item.title, `${path}.title`),
    state: enumAt(item.state, `${path}.state`, WORKSPACE_STATES),
    updated_at: timestampAt(item.updated_at, `${path}.updated_at`),
  };
}

export function parseReadyHealth(value: unknown): ReadyHealth {
  const item = objectAt(value, "$", ["status", "mode", "database", "filesystem", "job_runner"]);
  return {
    status: enumAt(item.status, "$.status", ["ready", "not_ready"] as const),
    mode: nonEmptyStringAt(item.mode, "$.mode"),
    database: componentHealthAt(item.database, "$.database"),
    filesystem: componentHealthAt(item.filesystem, "$.filesystem"),
    job_runner: componentHealthAt(item.job_runner, "$.job_runner"),
  };
}

export function parseProvidersHealth(value: unknown): ProvidersHealth {
  const item = objectAt(value, "$", ["ark", "asr", "ffmpeg", "web_search_enabled"]);
  return {
    ark: providerStatusAt(item.ark, "$.ark"),
    asr: providerStatusAt(item.asr, "$.asr"),
    ffmpeg: providerStatusAt(item.ffmpeg, "$.ffmpeg"),
    web_search_enabled: booleanAt(item.web_search_enabled, "$.web_search_enabled"),
  };
}

export function parseCollectionResponse(value: unknown): CollectionResponse {
  const item = objectAt(value, "$", ["is_demo_data", "notice", "videos", "categories", "recent_workspaces"]);
  return {
    is_demo_data: booleanAt(item.is_demo_data, "$.is_demo_data"),
    notice: stringAt(item.notice, "$.notice"),
    videos: arrayAt(item.videos, "$.videos", videoCardAt),
    categories: arrayAt(item.categories, "$.categories", categoryCardAt),
    recent_workspaces: arrayAt(item.recent_workspaces, "$.recent_workspaces", workspaceCardAt),
  };
}

export function parseJobEventCard(value: unknown, path = "$"): JobEventCard {
  const item = objectAt(value, path, ["sequence", "stage", "progress", "message", "created_at"]);
  const progress = integerAt(item.progress, `${path}.progress`, 0);
  if (progress > 100) throw new ContractParseError(`${path}.progress`, "expected integer <= 100");
  return {
    sequence: integerAt(item.sequence, `${path}.sequence`, 0),
    stage: nonEmptyStringAt(item.stage, `${path}.stage`),
    progress,
    message: nonEmptyStringAt(item.message, `${path}.message`),
    created_at: timestampAt(item.created_at, `${path}.created_at`),
  };
}

export function parseJobCard(value: unknown, path = "$"): JobCard {
  const item = objectAt(value, path, [
    "id",
    "kind",
    "status",
    "video_id",
    "attempts",
    "last_error",
    "created_at",
    "updated_at",
    "latest_event",
  ]);
  return {
    id: nonEmptyStringAt(item.id, `${path}.id`),
    kind: nonEmptyStringAt(item.kind, `${path}.kind`),
    status: enumAt(item.status, `${path}.status`, JOB_STATUSES),
    video_id: nullableAt(item.video_id, `${path}.video_id`, stringAt),
    attempts: integerAt(item.attempts, `${path}.attempts`, 0),
    last_error: nullableAt(item.last_error, `${path}.last_error`, stringAt),
    created_at: timestampAt(item.created_at, `${path}.created_at`),
    updated_at: timestampAt(item.updated_at, `${path}.updated_at`),
    latest_event: nullableAt(item.latest_event, `${path}.latest_event`, parseJobEventCard),
  };
}

export function parseJobListResponse(value: unknown): JobListResponse {
  const item = objectAt(value, "$", ["jobs"]);
  return { jobs: arrayAt(item.jobs, "$.jobs", parseJobCard) };
}

export function parseImportResponse(value: unknown): ImportResponse {
  const item = objectAt(value, "$", ["items"]);
  return {
    items: arrayAt(item.items, "$.items", (entry, path) => {
      const imported = objectAt(entry, path, ["video_id", "job_id", "filename", "duplicate"]);
      return {
        video_id: nonEmptyStringAt(imported.video_id, `${path}.video_id`),
        job_id: nullableAt(imported.job_id, `${path}.job_id`, stringAt),
        filename: nonEmptyStringAt(imported.filename, `${path}.filename`),
        duplicate: booleanAt(imported.duplicate, `${path}.duplicate`),
      };
    }),
  };
}

function launchScopeAt(value: unknown, path: string): LaunchScope {
  const item = objectAt(value, path, ["mode", "category_id", "video_ids"]);
  const mode = enumAt(item.mode, `${path}.mode`, LAUNCH_MODES);
  const categoryId = nullableAt(item.category_id, `${path}.category_id`, stringAt);
  const videoIds = uniqueIdsAt(
    arrayAt(item.video_ids, `${path}.video_ids`, nonEmptyStringAt),
    `${path}.video_ids`,
  );
  if (mode === "home" && (categoryId !== null || videoIds.length !== 0)) {
    throw new ContractParseError(path, "home scope requires category_id=null and video_ids=[]");
  }
  if ((mode === "major" || mode === "subcategory") && categoryId === null) {
    throw new ContractParseError(path, `${mode} scope requires category_id`);
  }
  if (mode === "single" && videoIds.length !== 1) {
    throw new ContractParseError(path, "single scope requires exactly one video_id");
  }
  if (mode === "selected" && videoIds.length < 2) {
    throw new ContractParseError(path, "selected scope requires at least two video_ids");
  }
  return { mode, category_id: categoryId, video_ids: videoIds };
}

export function parseAsyncWorkspaceResponse(value: unknown): AsyncWorkspaceResponse {
  const item = objectAt(value, "$", ["workspace_id", "job_id", "state"]);
  return {
    workspace_id: nonEmptyStringAt(item.workspace_id, "$.workspace_id"),
    job_id: nonEmptyStringAt(item.job_id, "$.job_id"),
    state: enumAt(item.state, "$.state", WORKSPACE_STATES),
  };
}

function workspaceMessageAt(value: unknown, path: string): WorkspaceMessage {
  const item = objectAt(value, path, ["id", "role", "content", "created_at"]);
  return {
    id: nonEmptyStringAt(item.id, `${path}.id`),
    role: enumAt(item.role, `${path}.role`, MESSAGE_ROLES),
    content: nonEmptyStringAt(item.content, `${path}.content`),
    created_at: timestampAt(item.created_at, `${path}.created_at`),
  };
}

function artifactItemAt(value: unknown, path: string): ArtifactItem {
  const item = objectAt(value, path, [
    "id",
    "text",
    "detail",
    "checked",
    "adjustment_rule",
    "provenance_ids",
  ]);
  const provenanceIds = uniqueIdsAt(
    arrayAt(item.provenance_ids, `${path}.provenance_ids`, nonEmptyStringAt),
    `${path}.provenance_ids`,
  );
  if (!provenanceIds.length) throw new ContractParseError(`${path}.provenance_ids`, "must not be empty");
  return {
    id: nonEmptyStringAt(item.id, `${path}.id`),
    text: nonEmptyStringAt(item.text, `${path}.text`),
    detail: nullableAt(item.detail, `${path}.detail`, stringAt),
    checked: booleanAt(item.checked, `${path}.checked`),
    adjustment_rule: nullableAt(item.adjustment_rule, `${path}.adjustment_rule`, stringAt),
    provenance_ids: provenanceIds,
  };
}

function artifactSectionAt(value: unknown, path: string): ArtifactSection {
  const item = objectAt(value, path, ["id", "title", "order", "items"]);
  return {
    id: nonEmptyStringAt(item.id, `${path}.id`),
    title: nonEmptyStringAt(item.title, `${path}.title`),
    order: integerAt(item.order, `${path}.order`, 0),
    items: arrayAt(item.items, `${path}.items`, artifactItemAt),
  };
}

function artifactCompactVariantAt(value: unknown, path: string): ArtifactCompactVariant {
  const item = objectAt(value, path, ["title", "lines"]);
  const lines = arrayAt(item.lines, `${path}.lines`, nonEmptyStringAt);
  if (lines.length === 0 || lines.length > 8) {
    throw new ContractParseError(`${path}.lines`, "expected 1 to 8 compact lines");
  }
  return {
    title: nonEmptyStringAt(item.title, `${path}.title`),
    lines,
  };
}

function artifactConflictViewpointAt(value: unknown, path: string): ArtifactConflictViewpoint {
  const item = objectAt(value, path, ["statement", "provenance_ids"]);
  const provenanceIds = arrayAt(item.provenance_ids, `${path}.provenance_ids`, nonEmptyStringAt);
  if (provenanceIds.length === 0) {
    throw new ContractParseError(`${path}.provenance_ids`, "conflict viewpoint requires at least one provenance id");
  }
  uniqueIdsAt(provenanceIds, `${path}.provenance_ids`);
  return {
    statement: nonEmptyStringAt(item.statement, `${path}.statement`),
    provenance_ids: provenanceIds,
  };
}

function artifactConflictDetailAt(value: unknown, path: string): ArtifactConflictDetail {
  const item = objectAt(value, path, ["topic", "viewpoints", "resolution"]);
  const viewpoints = arrayAt(item.viewpoints, `${path}.viewpoints`, artifactConflictViewpointAt);
  if (viewpoints.length < 2) {
    throw new ContractParseError(`${path}.viewpoints`, "conflict requires at least two sourced viewpoints");
  }
  return {
    topic: nonEmptyStringAt(item.topic, `${path}.topic`),
    viewpoints,
    resolution: nullableAt(item.resolution, `${path}.resolution`, nonEmptyStringAt),
  };
}

export function parseArtifactDocument(value: unknown, path = "$"): ArtifactDocument {
  const normalizedValue = (
    typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && !("conflict_details" in value)
  ) ? { ...value, conflict_details: [] } : value;
  const item = objectAt(normalizedValue, path, [
    "id",
    "kind",
    "title",
    "purpose",
    "sections",
    "conflicts",
    "conflict_details",
    "uncertainties",
    "compact_variant",
    "version",
    "created_at",
    "updated_at",
  ]);
  const sections = arrayAt(item.sections, `${path}.sections`, artifactSectionAt);
  const sectionIds = sections.map((section) => section.id);
  uniqueIdsAt(sectionIds, `${path}.sections[].id`);
  const itemIds = sections.flatMap((section) => section.items.map((artifactItem) => artifactItem.id));
  uniqueIdsAt(itemIds, `${path}.sections[].items[].id`);
  const orderedSections = [...sections].sort((left, right) => left.order - right.order);
  const requiredStages = ["拍摄前", "到场后", "拍完后"];
  if (
    orderedSections.length !== requiredStages.length
    || orderedSections.some((section, index) => section.order !== index || section.title !== requiredStages[index])
  ) {
    throw new ContractParseError(`${path}.sections`, "shooting task card requires 拍摄前, 到场后, 拍完后 in order");
  }
  return {
    id: nonEmptyStringAt(item.id, `${path}.id`),
    kind: enumAt(item.kind, `${path}.kind`, ["shooting_task_card"] as const),
    title: nonEmptyStringAt(item.title, `${path}.title`),
    purpose: nonEmptyStringAt(item.purpose, `${path}.purpose`),
    sections,
    conflicts: arrayAt(item.conflicts, `${path}.conflicts`, nonEmptyStringAt),
    conflict_details: arrayAt(item.conflict_details, `${path}.conflict_details`, artifactConflictDetailAt),
    uncertainties: arrayAt(item.uncertainties, `${path}.uncertainties`, nonEmptyStringAt),
    compact_variant: nullableAt(item.compact_variant, `${path}.compact_variant`, artifactCompactVariantAt),
    version: integerAt(item.version, `${path}.version`, 1),
    created_at: timestampAt(item.created_at, `${path}.created_at`),
    updated_at: timestampAt(item.updated_at, `${path}.updated_at`),
  };
}

export function parseWorkspaceDetail(value: unknown): WorkspaceDetail {
  const item = objectAt(value, "$", [
    "id",
    "generated_title",
    "original_goal",
    "launch_scope",
    "state",
    "adopted_videos",
    "excluded_videos",
    "confirmed_constraints",
    "messages",
    "active_job",
    "artifact",
    "scope_expansion_options",
    "created_at",
    "updated_at",
  ]);
  const parseVideoDecision = (entry: unknown, path: string) => {
    const decision = objectAt(entry, path, ["video_id", "reason"]);
    return {
      video_id: nonEmptyStringAt(decision.video_id, `${path}.video_id`),
      reason: nonEmptyStringAt(decision.reason, `${path}.reason`),
    };
  };
  const adoptedVideos = arrayAt(item.adopted_videos, "$.adopted_videos", parseVideoDecision);
  const excludedVideos = arrayAt(item.excluded_videos, "$.excluded_videos", parseVideoDecision);
  const scopeExpansionOptions = arrayAt(
    item.scope_expansion_options,
    "$.scope_expansion_options",
    (entry, path) => {
      const option = objectAt(entry, path, ["target", "label", "candidate_count"]);
      return {
        target: enumAt(option.target, `${path}.target`, ["parent", "home"] as const),
        label: nonEmptyStringAt(option.label, `${path}.label`),
        candidate_count: integerAt(option.candidate_count, `${path}.candidate_count`, 1),
      };
    },
  );
  if (new Set(scopeExpansionOptions.map((option) => option.target)).size !== scopeExpansionOptions.length) {
    throw new ContractParseError("$.scope_expansion_options", "expected unique target values");
  }
  const adoptedIds = adoptedVideos.map((entry) => entry.video_id);
  const excludedIds = excludedVideos.map((entry) => entry.video_id);
  if (new Set(adoptedIds).size !== adoptedIds.length) {
    throw new ContractParseError("$.adopted_videos", "expected unique video_id values");
  }
  if (new Set(excludedIds).size !== excludedIds.length) {
    throw new ContractParseError("$.excluded_videos", "expected unique video_id values");
  }
  if (adoptedIds.some((id) => excludedIds.includes(id))) {
    throw new ContractParseError("$", "adopted_videos and excluded_videos must not overlap");
  }
  return {
    id: nonEmptyStringAt(item.id, "$.id"),
    generated_title: nonEmptyStringAt(item.generated_title, "$.generated_title"),
    original_goal: nonEmptyStringAt(item.original_goal, "$.original_goal"),
    launch_scope: launchScopeAt(item.launch_scope, "$.launch_scope"),
    state: enumAt(item.state, "$.state", WORKSPACE_STATES),
    adopted_videos: adoptedVideos,
    excluded_videos: excludedVideos,
    confirmed_constraints: arrayAt(item.confirmed_constraints, "$.confirmed_constraints", nonEmptyStringAt),
    messages: arrayAt(item.messages, "$.messages", workspaceMessageAt),
    active_job: nullableAt(item.active_job, "$.active_job", parseJobCard),
    artifact: nullableAt(item.artifact, "$.artifact", parseArtifactDocument),
    scope_expansion_options: scopeExpansionOptions,
    created_at: timestampAt(item.created_at, "$.created_at"),
    updated_at: timestampAt(item.updated_at, "$.updated_at"),
  };
}

export function parseReviseArtifactResponse(value: unknown): ReviseArtifactResponse {
  const item = objectAt(value, "$", ["artifact_id", "job_id", "version_before"]);
  return {
    artifact_id: nonEmptyStringAt(item.artifact_id, "$.artifact_id"),
    job_id: nonEmptyStringAt(item.job_id, "$.job_id"),
    version_before: integerAt(item.version_before, "$.version_before", 1),
  };
}

export function parseCheckArtifactItemResponse(value: unknown): CheckArtifactItemResponse {
  const item = objectAt(value, "$", ["artifact_id", "item_id", "checked", "updated_at"]);
  return {
    artifact_id: nonEmptyStringAt(item.artifact_id, "$.artifact_id"),
    item_id: nonEmptyStringAt(item.item_id, "$.item_id"),
    checked: booleanAt(item.checked, "$.checked"),
    updated_at: timestampAt(item.updated_at, "$.updated_at"),
  };
}

function videoProvenanceViewAt(value: unknown, path: string): VideoProvenanceView {
  const item = objectAt(value, path, ["title", "author", "thumbnail_url", "playback_url", "source_url"]);
  return {
    title: nonEmptyStringAt(item.title, `${path}.title`),
    author: nullableAt(item.author, `${path}.author`, stringAt),
    thumbnail_url: nullableAt(item.thumbnail_url, `${path}.thumbnail_url`, stringAt),
    playback_url: nullableAt(item.playback_url, `${path}.playback_url`, stringAt),
    source_url: nullableAt(item.source_url, `${path}.source_url`, stringAt),
  };
}

function webProvenanceViewAt(value: unknown, path: string): WebProvenanceView {
  const item = objectAt(value, path, ["title", "url", "publisher"]);
  return {
    title: nonEmptyStringAt(item.title, `${path}.title`),
    url: nonEmptyStringAt(item.url, `${path}.url`),
    publisher: nullableAt(item.publisher, `${path}.publisher`, stringAt),
  };
}

export function parseProvenanceDetail(value: unknown): ProvenanceDetail {
  const item = objectAt(value, "$", [
    "id",
    "kind",
    "source_id",
    "evidence_summary",
    "confidence",
    "start_ms",
    "end_ms",
    "retrieved_at",
    "video",
    "web",
  ]);
  const kind = enumAt(item.kind, "$.kind", PROVENANCE_KINDS);
  const startMs = nullableAt(item.start_ms, "$.start_ms", (entry, path) => integerAt(entry, path, 0));
  const endMs = nullableAt(item.end_ms, "$.end_ms", (entry, path) => integerAt(entry, path, 0));
  const video = nullableAt(item.video, "$.video", videoProvenanceViewAt);
  const web = nullableAt(item.web, "$.web", webProvenanceViewAt);
  const retrievedAt = nullableAt(item.retrieved_at, "$.retrieved_at", timestampAt);
  if (startMs !== null && endMs !== null && endMs < startMs) {
    throw new ContractParseError("$.end_ms", "must be greater than or equal to start_ms");
  }
  if (kind === "video" && (video === null || startMs === null || endMs === null || web !== null)) {
    throw new ContractParseError("$", "video provenance requires video and time range only");
  }
  if (kind === "web" && (web === null || retrievedAt === null || video !== null)) {
    throw new ContractParseError("$", "web provenance requires web and retrieved_at only");
  }
  if (kind === "inference" && (video !== null || web !== null)) {
    throw new ContractParseError("$", "inference provenance must not claim external source views");
  }
  return {
    id: nonEmptyStringAt(item.id, "$.id"),
    kind,
    source_id: nonEmptyStringAt(item.source_id, "$.source_id"),
    evidence_summary: nonEmptyStringAt(item.evidence_summary, "$.evidence_summary"),
    confidence: nullableAt(item.confidence, "$.confidence", confidenceAt),
    start_ms: startMs,
    end_ms: endMs,
    retrieved_at: retrievedAt,
    video,
    web,
  };
}

export function parseCategoryDetail(value: unknown): CategoryDetail {
  const item = objectAt(value, "$", ["id", "parent_id", "level", "name", "purpose", "videos", "subcategories"]);
  const level = integerAt(item.level, "$.level", 1);
  if (level !== 1 && level !== 2) throw new ContractParseError("$.level", "expected 1 or 2");
  return {
    id: nonEmptyStringAt(item.id, "$.id"),
    parent_id: nullableAt(item.parent_id, "$.parent_id", stringAt),
    level,
    name: nonEmptyStringAt(item.name, "$.name"),
    purpose: nonEmptyStringAt(item.purpose, "$.purpose"),
    videos: arrayAt(item.videos, "$.videos", videoCardAt),
    subcategories: arrayAt(item.subcategories, "$.subcategories", subcategoryCardAt),
  };
}
