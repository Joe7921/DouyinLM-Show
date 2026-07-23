import type {
  AsyncWorkspaceResponse,
  CategoryDetail,
  CheckArtifactItemRequest,
  CheckArtifactItemResponse,
  CollectionResponse,
  CreateWorkspaceRequest,
  ExpandWorkspaceScopeRequest,
  ImportResponse,
  ImportVideosInput,
  JobCard,
  JobEventHandlers,
  JobEventSubscription,
  JobListResponse,
  ProvidersHealth,
  ProvenanceDetail,
  ReadyHealth,
  ReviseArtifactRequest,
  ReviseArtifactResponse,
  SendMessageRequest,
  SendMessageResponse,
  WorkspaceDetail,
} from "../contracts";

export type DataMode = "live" | "mock";

export class GatewayRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, code = "request_failed", retryable = false) {
    super(message);
    this.name = "GatewayRequestError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface DouyinLMGateway {
  readonly mode: DataMode;
  getReady(): Promise<ReadyHealth>;
  getProviders(): Promise<ProvidersHealth>;
  getCollection(): Promise<CollectionResponse>;
  getCategory(id: string): Promise<CategoryDetail>;
  createWorkspace(input: CreateWorkspaceRequest): Promise<AsyncWorkspaceResponse>;
  sendMessage(id: string, input: SendMessageRequest): Promise<SendMessageResponse>;
  expandWorkspaceScope(id: string, input: ExpandWorkspaceScopeRequest): Promise<AsyncWorkspaceResponse>;
  getWorkspace(id: string): Promise<WorkspaceDetail>;
  reviseArtifact(id: string, input: ReviseArtifactRequest): Promise<ReviseArtifactResponse>;
  checkArtifactItem(
    artifactId: string,
    itemId: string,
    input: CheckArtifactItemRequest,
  ): Promise<CheckArtifactItemResponse>;
  getProvenance(id: string): Promise<ProvenanceDetail>;
  getJobs(): Promise<JobListResponse>;
  getJob(id: string): Promise<JobCard>;
  retryJob(id: string): Promise<JobCard>;
  reanalyzeVideo(id: string): Promise<JobCard>;
  importVideos(input: ImportVideosInput): Promise<ImportResponse>;
  subscribeJob(id: string, handlers: JobEventHandlers, afterSequence?: number): JobEventSubscription;
}

export class GatewayCapabilityError extends GatewayRequestError {
  constructor(capability: string) {
    super(`当前数据源尚未提供能力：${capability}`, "capability_not_available", false);
    this.name = "GatewayCapabilityError";
  }
}
