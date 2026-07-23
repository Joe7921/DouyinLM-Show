export type ComponentHealth = {
  ok: boolean;
  detail: string;
};

export type ReadyHealth = {
  status: "ready" | "not_ready";
  mode: string;
  database: ComponentHealth;
  filesystem: ComponentHealth;
  job_runner: ComponentHealth;
};

export type ProviderStatus = {
  configured: boolean;
  required_from_gate: string;
  detail: string | null;
};

export type ProvidersHealth = {
  ark: ProviderStatus;
  asr: ProviderStatus;
  ffmpeg: ProviderStatus;
  web_search_enabled: boolean;
};

export type VideoStatus =
  | "queued"
  | "processing"
  | "transcribing"
  | "classifying"
  | "ready"
  | "needs_configuration"
  | "failed";

export type VideoCard = {
  id: string;
  title: string;
  author: string | null;
  source_url: string | null;
  status: VideoStatus;
  purpose_line: string | null;
  summary: string | null;
  content_types: string[];
  duration_ms: number | null;
  thumbnail_url: string | null;
  current_job_id: string | null;
  error_code: string | null;
  error_message: string | null;
};

export type SubcategoryCard = {
  id: string;
  name: string;
  purpose: string;
  video_count: number;
};

export type CategoryCard = {
  id: string;
  name: string;
  purpose: string;
  video_count: number;
  subcategories: SubcategoryCard[];
};

export type WorkspaceState = "forming" | "clarifying" | "compiling" | "ready" | "failed";

export type WorkspaceCard = {
  id: string;
  title: string;
  state: WorkspaceState;
  updated_at: string;
};

export type CollectionResponse = {
  is_demo_data: boolean;
  notice: string;
  videos: VideoCard[];
  categories: CategoryCard[];
  recent_workspaces: WorkspaceCard[];
};

export type JobStatus = "queued" | "running" | "completed" | "failed" | "blocked";

export type JobEventCard = {
  sequence: number;
  stage: string;
  progress: number;
  message: string;
  created_at: string;
};

export type JobCard = {
  id: string;
  kind: string;
  status: JobStatus;
  video_id: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  latest_event: JobEventCard | null;
};

export type JobListResponse = {
  jobs: JobCard[];
};

export type ImportResponse = {
  items: Array<{
    video_id: string;
    job_id: string | null;
    filename: string;
    duplicate: boolean;
  }>;
};

export type LaunchMode = "home" | "major" | "subcategory" | "selected" | "single";

export type LaunchScope = {
  mode: LaunchMode;
  category_id: string | null;
  video_ids: string[];
};

export type ScopeExpansionTarget = "parent" | "home";

export type ScopeExpansionOption = {
  target: ScopeExpansionTarget;
  label: string;
  candidate_count: number;
};

export type ExpandWorkspaceScopeRequest = {
  target: ScopeExpansionTarget;
};

export type CreateWorkspaceRequest = {
  goal: string;
  launch_scope: LaunchScope;
};

export type AsyncWorkspaceResponse = {
  workspace_id: string;
  job_id: string;
  state: WorkspaceState;
};

export type SendMessageRequest = {
  text: string;
};

export type SendMessageResponse = AsyncWorkspaceResponse;

export type AdoptedVideo = {
  video_id: string;
  reason: string;
};

export type ExcludedVideo = {
  video_id: string;
  reason: string;
};

export type WorkspaceMessageRole = "user" | "assistant" | "system_event";

export type WorkspaceMessage = {
  id: string;
  role: WorkspaceMessageRole;
  content: string;
  created_at: string;
};

export type ArtifactKind = "shooting_task_card";

export type ArtifactItem = {
  id: string;
  text: string;
  detail: string | null;
  checked: boolean;
  adjustment_rule: string | null;
  provenance_ids: string[];
};

export type ArtifactSection = {
  id: string;
  title: string;
  order: number;
  items: ArtifactItem[];
};

export type ArtifactCompactVariant = {
  title: string;
  lines: string[];
};

export type ArtifactConflictViewpoint = {
  statement: string;
  provenance_ids: string[];
};

export type ArtifactConflictDetail = {
  topic: string;
  viewpoints: ArtifactConflictViewpoint[];
  resolution: string | null;
};

export type ArtifactDocument = {
  id: string;
  kind: ArtifactKind;
  title: string;
  purpose: string;
  sections: ArtifactSection[];
  conflicts: string[];
  conflict_details: ArtifactConflictDetail[];
  uncertainties: string[];
  compact_variant: ArtifactCompactVariant | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type WorkspaceDetail = {
  id: string;
  generated_title: string;
  original_goal: string;
  launch_scope: LaunchScope;
  state: WorkspaceState;
  adopted_videos: AdoptedVideo[];
  excluded_videos: ExcludedVideo[];
  confirmed_constraints: string[];
  messages: WorkspaceMessage[];
  active_job: JobCard | null;
  artifact: ArtifactDocument | null;
  scope_expansion_options: ScopeExpansionOption[];
  created_at: string;
  updated_at: string;
};

export type ReviseArtifactRequest = {
  instruction: string;
};

export type ReviseArtifactResponse = {
  artifact_id: string;
  job_id: string;
  version_before: number;
};

export type CheckArtifactItemRequest = {
  checked: boolean;
};

export type CheckArtifactItemResponse = {
  artifact_id: string;
  item_id: string;
  checked: boolean;
  updated_at: string;
};

export type ProvenanceKind = "video" | "web" | "inference";

export type VideoProvenanceView = {
  title: string;
  author: string | null;
  thumbnail_url: string | null;
  playback_url: string | null;
  source_url: string | null;
};

export type WebProvenanceView = {
  title: string;
  url: string;
  publisher: string | null;
};

export type ProvenanceDetail = {
  id: string;
  kind: ProvenanceKind;
  source_id: string;
  evidence_summary: string;
  confidence: number | null;
  start_ms: number | null;
  end_ms: number | null;
  retrieved_at: string | null;
  video: VideoProvenanceView | null;
  web: WebProvenanceView | null;
};

export type CategoryDetail = {
  id: string;
  parent_id: string | null;
  level: 1 | 2;
  name: string;
  purpose: string;
  videos: VideoCard[];
  subcategories: SubcategoryCard[];
};

export type ImportVideosInput = {
  files: File[];
  manifestJson: string;
  permissionScope: string;
};

export type JobEventHandlers = {
  onEvent: (event: JobEventCard) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
};

export type JobEventSubscription = {
  close: () => void;
};
