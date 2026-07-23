import type {
  CategoryDetail,
  CollectionResponse,
  JobEventCard,
  ProvidersHealth,
  ProvenanceDetail,
  ReadyHealth,
  WorkspaceDetail,
} from "../../contracts";

export type MockScenarioKey =
  | "happy_path"
  | "clarification_once"
  | "processing"
  | "parse_failed"
  | "provider_blocked"
  | "artifact_validation_failed"
  | "insufficient_scope"
  | "empty_collection";

export type FixtureOrigin = "handcrafted" | "pipeline_export";

export type MockFailure = {
  code: string;
  message: string;
  retryable: boolean;
};

export type MockScenario = {
  key: MockScenarioKey;
  origin: FixtureOrigin;
  collection: CollectionResponse;
  ready: ReadyHealth;
  providers: ProvidersHealth;
  categories: Record<string, CategoryDetail>;
  workspaceTemplate: WorkspaceDetail;
  provenance: Record<string, ProvenanceDetail>;
  jobEvents: JobEventCard[];
  retryJobEvents: JobEventCard[];
  clarification: { question: string } | null;
  failure: MockFailure | null;
  recoveryWorkspaceTemplate: WorkspaceDetail | null;
};
