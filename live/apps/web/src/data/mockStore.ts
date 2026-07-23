import type {
  AsyncWorkspaceResponse,
  CategoryDetail,
  CheckArtifactItemResponse,
  CollectionResponse,
  CreateWorkspaceRequest,
  ExpandWorkspaceScopeRequest,
  ImportResponse,
  ImportVideosInput,
  JobCard,
  JobEventCard,
  JobListResponse,
  ProvidersHealth,
  ProvenanceDetail,
  ReadyHealth,
  ReviseArtifactResponse,
  SendMessageRequest,
  WorkspaceDetail,
} from "../contracts";
import type { MockScenario } from "./fixtures";
import { GatewayRequestError } from "./gateway";

const MOCK_NOW = "2026-07-21T12:00:08+08:00";

export type MockKeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type PersistedMockState = {
  version: 1;
  collection: CollectionResponse;
  workspaces: Array<[string, WorkspaceDetail]>;
  jobs: Array<[string, JobCard]>;
  workspaceCounter: number;
  jobCounter: number;
};

function copy<T>(value: T): T {
  return structuredClone(value);
}

export class MockStore {
  private readonly scenario: MockScenario;
  private readonly categories: Record<string, CategoryDetail>;
  private readonly provenance: Record<string, ProvenanceDetail>;
  private readonly workspaces = new Map<string, WorkspaceDetail>();
  private readonly jobs = new Map<string, JobCard>();
  private readonly jobFinalizers = new Map<string, () => void>();
  private collection: CollectionResponse;
  private workspaceCounter = 0;
  private jobCounter = 0;
  private readonly storage?: MockKeyValueStorage;
  private readonly storageKey: string;

  constructor(
    scenario: MockScenario,
    options: { storage?: MockKeyValueStorage; storageKey?: string } = {},
  ) {
    this.scenario = copy(scenario);
    this.collection = copy(scenario.collection);
    this.categories = copy(scenario.categories);
    this.provenance = copy(scenario.provenance);
    this.storage = options.storage;
    this.storageKey = options.storageKey ?? "douyinlm.mock.v1";
    this.restore();
  }

  getReady(): ReadyHealth {
    return copy(this.scenario.ready);
  }

  getProviders(): ProvidersHealth {
    return copy(this.scenario.providers);
  }

  getCollection(): CollectionResponse {
    return copy(this.collection);
  }

  getCategory(id: string): CategoryDetail {
    const category = this.categories[id];
    if (!category) throw new Error(`Mock 类目不存在：${id}`);
    return copy(category);
  }

  createWorkspace(input: CreateWorkspaceRequest): AsyncWorkspaceResponse {
    const goal = input.goal.trim();
    if (!goal) throw new Error("目标不能为空");

    this.workspaceCounter += 1;
    const workspaceId = `mock-workspace-${String(this.workspaceCounter).padStart(3, "0")}`;
    const jobId = this.nextJobId();
    const job = this.createJob(jobId, "compile_collection_artifact");
    const finalWorkspace = copy(this.scenario.workspaceTemplate);
    finalWorkspace.id = workspaceId;
    finalWorkspace.original_goal = goal;
    finalWorkspace.launch_scope = copy(input.launch_scope);
    finalWorkspace.messages = finalWorkspace.messages.map((message, index) =>
      index === 0 ? { ...message, content: goal } : message,
    );
    finalWorkspace.active_job = null;

    const formingWorkspace: WorkspaceDetail = {
      ...copy(finalWorkspace),
      state: "forming",
      adopted_videos: [],
      excluded_videos: [],
      confirmed_constraints: [],
      messages: [copy(finalWorkspace.messages[0])],
      active_job: copy(job),
      artifact: null,
      scope_expansion_options: [],
      updated_at: job.created_at,
    };
    this.workspaces.set(workspaceId, formingWorkspace);
    const completionTemplate = this.scenario.recoveryWorkspaceTemplate
      ? copy(this.scenario.recoveryWorkspaceTemplate)
      : finalWorkspace;
    completionTemplate.id = workspaceId;
    completionTemplate.original_goal = goal;
    completionTemplate.launch_scope = copy(input.launch_scope);
    completionTemplate.messages = completionTemplate.messages.map((message, index) =>
      index === 0 ? { ...message, content: goal } : message,
    );
    const initialCompletion = this.scenario.clarification
      ? this.buildClarifyingWorkspace(completionTemplate)
      : completionTemplate;
    this.jobFinalizers.set(jobId, () => this.finishWorkspace(workspaceId, initialCompletion));
    this.updateRecentWorkspace(formingWorkspace);
    this.persist();

    return { workspace_id: workspaceId, job_id: jobId, state: "forming" };
  }

  sendMessage(id: string, input: SendMessageRequest): AsyncWorkspaceResponse {
    const workspace = this.requireWorkspace(id);
    const text = input.text.trim();
    if (!text) throw new Error("消息不能为空");
    const jobId = this.nextJobId();
    const job = this.createJob(jobId, "continue_workspace");
    const next = copy(workspace);
    next.state = "compiling";
    next.active_job = copy(job);
    next.messages.push({
      id: `mock-message-${next.messages.length + 1}`,
      role: "user",
      content: text,
      created_at: MOCK_NOW,
    });
    next.updated_at = MOCK_NOW;
    this.workspaces.set(id, next);

    const finalWorkspace = this.buildFinalWorkspace(next);
    this.jobFinalizers.set(jobId, () => this.finishWorkspace(id, finalWorkspace));
    this.updateRecentWorkspace(next);
    this.persist();
    return { workspace_id: id, job_id: jobId, state: "compiling" };
  }

  expandWorkspaceScope(id: string, input: ExpandWorkspaceScopeRequest): AsyncWorkspaceResponse {
    const workspace = this.requireWorkspace(id);
    const option = workspace.scope_expansion_options.find((entry) => entry.target === input.target);
    if (workspace.state !== "failed" || !option) {
      throw new GatewayRequestError(
        "当前工作区没有这个可用的范围扩大选项。",
        "scope_expansion_not_available",
        false,
      );
    }

    let launchScope = workspace.launch_scope;
    if (input.target === "parent") {
      const categoryId = workspace.launch_scope.category_id;
      const category = categoryId ? this.categories[categoryId] : undefined;
      if (!category?.parent_id) {
        throw new GatewayRequestError("当前范围没有可扩大的上一级。", "scope_parent_not_available", false);
      }
      launchScope = { mode: "major", category_id: category.parent_id, video_ids: [] };
    } else {
      launchScope = { mode: "home", category_id: null, video_ids: [] };
    }

    const jobId = this.nextJobId();
    const job = this.createJob(jobId, "expand_workspace_scope");
    const next = copy(workspace);
    next.launch_scope = launchScope;
    next.state = "forming";
    next.active_job = copy(job);
    next.scope_expansion_options = [];
    next.updated_at = MOCK_NOW;
    next.messages.push({
      id: `mock-message-scope-expansion-${next.messages.length + 1}`,
      role: "system_event",
      content: `用户确认${option.label}；已重新锁定 ${option.candidate_count} 条候选内容。`,
      created_at: MOCK_NOW,
    });
    this.workspaces.set(id, next);

    const finalWorkspace = this.buildFinalWorkspace(next);
    this.jobFinalizers.set(jobId, () => this.finishWorkspace(id, finalWorkspace));
    this.updateRecentWorkspace(next);
    this.persist();
    return { workspace_id: id, job_id: jobId, state: "forming" };
  }

  getWorkspace(id: string): WorkspaceDetail {
    return copy(this.requireWorkspace(id));
  }

  reviseArtifact(id: string, instruction: string): ReviseArtifactResponse {
    const entry = this.findArtifact(id);
    if (!instruction.trim()) throw new Error("修改指令不能为空");
    const versionBefore = entry.workspace.artifact?.version;
    if (versionBefore === undefined) throw new Error(`Mock Artifact 不存在：${id}`);
    const jobId = this.nextJobId();
    const job = this.createJob(jobId, "revise_artifact");
    const working = copy(entry.workspace);
    working.state = "compiling";
    working.active_job = copy(job);
    this.workspaces.set(entry.workspaceId, working);

    const revised = copy(entry.workspace);
    const artifact = revised.artifact;
    if (!artifact) throw new Error(`Mock Artifact 不存在：${id}`);
    artifact.version = versionBefore + 1;
    artifact.updated_at = MOCK_NOW;
    artifact.compact_variant = {
      title: "现场一屏小纸条",
      lines: [
        "拍前：设备、电量、存储和参数起点",
        "到场：先看光线，再定站位与机位",
        "必拍：远景、中景、近景各一组",
        "离场：放大检查对焦并核对画面",
      ],
    };
    revised.messages.push({
      id: `mock-message-${revised.messages.length + 1}`,
      role: "user",
      content: instruction.trim(),
      created_at: MOCK_NOW,
    });
    revised.state = "ready";
    revised.active_job = null;
    revised.updated_at = MOCK_NOW;
    this.jobFinalizers.set(jobId, () => this.finishWorkspace(entry.workspaceId, revised));
    this.updateRecentWorkspace(working);
    this.persist();
    return { artifact_id: id, job_id: jobId, version_before: versionBefore };
  }

  checkArtifactItem(artifactId: string, itemId: string, checked: boolean): CheckArtifactItemResponse {
    const entry = this.findArtifact(artifactId);
    const artifact = entry.workspace.artifact;
    if (!artifact) throw new Error(`Mock Artifact 不存在：${artifactId}`);
    const item = artifact.sections.flatMap((section) => section.items).find((candidate) => candidate.id === itemId);
    if (!item) throw new Error(`Mock Artifact item 不存在：${itemId}`);
    item.checked = checked;
    entry.workspace.updated_at = MOCK_NOW;
    this.workspaces.set(entry.workspaceId, entry.workspace);
    this.persist();
    return { artifact_id: artifactId, item_id: itemId, checked, updated_at: MOCK_NOW };
  }

  getProvenance(id: string): ProvenanceDetail {
    const detail = this.provenance[id];
    if (!detail) throw new Error(`Mock 来源不存在：${id}`);
    return copy(detail);
  }

  getJobs(): JobListResponse {
    return { jobs: [...this.jobs.values()].reverse().map(copy) };
  }

  getJob(id: string): JobCard {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Mock 任务不存在：${id}`);
    return copy(job);
  }

  retryJob(id: string): JobCard {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Mock 任务不存在：${id}`);
    if (job.status !== "failed" && job.status !== "blocked") {
      throw new Error("只有 failed/blocked Mock 任务可以重试");
    }
    if (this.scenario.failure && !this.scenario.failure.retryable) {
      throw new GatewayRequestError(
        this.scenario.failure.message,
        this.scenario.failure.code,
        false,
      );
    }
    job.attempts += 1;
    job.status = "queued";
    job.last_error = null;
    job.updated_at = MOCK_NOW;
    const workspaceEntry = this.findWorkspaceByJob(id);
    if (workspaceEntry) {
      const next = copy(workspaceEntry.workspace);
      next.state = next.artifact ? "compiling" : "forming";
      next.active_job = copy(job);
      next.updated_at = MOCK_NOW;
      next.messages.push({
        id: `mock-message-retry-${job.attempts}`,
        role: "system_event",
        content: "已从原工作区重新尝试，没有创建第二个工作区。",
        created_at: MOCK_NOW,
      });
      this.workspaces.set(workspaceEntry.workspaceId, next);
      this.updateRecentWorkspace(next);
    }
    this.persist();
    return copy(job);
  }

  reanalyzeVideo(videoId: string): JobCard {
    if (!this.collection.videos.some((video) => video.id === videoId)) {
      throw new Error(`Mock 视频不存在：${videoId}`);
    }
    const jobId = this.nextJobId();
    const job = this.createJob(jobId, "analyze_video", videoId);
    this.persist();
    return copy(job);
  }

  importVideos(input: ImportVideosInput): ImportResponse {
    return {
      items: input.files.map((file, index) => ({
        video_id: `mock-import-video-${index + 1}`,
        job_id: null,
        filename: file.name,
        duplicate: false,
      })),
    };
  }

  getJobEvents(id: string, afterSequence = 0): JobEventCard[] {
    const job = this.getJob(id);
    const events = (job.attempts > 0 || job.kind === "expand_workspace_scope") && this.scenario.retryJobEvents.length > 0
      ? this.scenario.retryJobEvents
      : this.scenario.jobEvents;
    return events.filter((event) => event.sequence > afterSequence).map(copy);
  }

  applyJobEvent(id: string, event: JobEventCard): void {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Mock 任务不存在：${id}`);
    const failed = event.stage === "failed" || event.stage === "blocked";
    job.status = event.stage === "failed" ? "failed" : event.stage === "blocked" ? "blocked" : "running";
    job.latest_event = copy(event);
    job.updated_at = event.created_at;
    job.last_error = failed ? (this.scenario.failure?.message ?? event.message) : null;
    const workspaceEntry = this.findWorkspaceByJob(id);
    if (workspaceEntry) {
      const nextWorkspace = copy(workspaceEntry.workspace);
      nextWorkspace.active_job = copy(job);
      nextWorkspace.updated_at = event.created_at;
      if (failed) {
        nextWorkspace.state = "failed";
        nextWorkspace.scope_expansion_options = copy(this.scenario.workspaceTemplate.scope_expansion_options);
        if (!nextWorkspace.messages.some((message) => message.content === job.last_error)) {
          nextWorkspace.messages.push({
            id: `mock-message-job-${id}-failure`,
            role: "system_event",
            content: job.last_error ?? event.message,
            created_at: event.created_at,
          });
        }
      }
      this.workspaces.set(workspaceEntry.workspaceId, nextWorkspace);
      this.updateRecentWorkspace(nextWorkspace);
    }
    if (event.stage === "completed" || event.stage === "ready") {
      job.status = "completed";
      this.jobFinalizers.get(id)?.();
      this.jobFinalizers.delete(id);
    }
    this.persist();
  }

  private restore(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return;
      const state = JSON.parse(raw) as PersistedMockState;
      if (state.version !== 1 || !Array.isArray(state.workspaces) || !Array.isArray(state.jobs)) return;
      this.collection = copy(state.collection);
      for (const [id, workspace] of state.workspaces) this.workspaces.set(id, copy(workspace));
      for (const [id, job] of state.jobs) this.jobs.set(id, copy(job));
      this.workspaceCounter = state.workspaceCounter;
      this.jobCounter = state.jobCounter;
      this.rebuildPendingFinalizers();
    } catch {
      // Session data is disposable development state; invalid data falls back to the fixture.
    }
  }

  private rebuildPendingFinalizers(): void {
    for (const [workspaceId, workspace] of this.workspaces) {
      const jobId = workspace.active_job?.id;
      const job = jobId ? this.jobs.get(jobId) : undefined;
      if (!jobId || !job) continue;

      if (workspace.artifact) {
        const finalWorkspace = copy(workspace);
        finalWorkspace.state = "ready";
        finalWorkspace.active_job = null;
        this.jobFinalizers.set(jobId, () => this.finishWorkspace(workspaceId, finalWorkspace));
        continue;
      }

      const finalWorkspace = this.buildFinalWorkspace(workspace);
      const completion = job.kind === "compile_collection_artifact" && this.scenario.clarification
        ? this.buildClarifyingWorkspace(finalWorkspace)
        : finalWorkspace;
      this.jobFinalizers.set(jobId, () => this.finishWorkspace(workspaceId, completion));
    }
  }

  private buildFinalWorkspace(workspace: WorkspaceDetail): WorkspaceDetail {
    const finalWorkspace = copy(
      this.scenario.recoveryWorkspaceTemplate ?? this.scenario.workspaceTemplate,
    );
    finalWorkspace.id = workspace.id;
    finalWorkspace.original_goal = workspace.original_goal;
    finalWorkspace.launch_scope = copy(workspace.launch_scope);
    finalWorkspace.scope_expansion_options = [];
    const additionalMessages = finalWorkspace.messages.slice(1).filter(
      (templateMessage) => !workspace.messages.some(
        (message) => message.role === templateMessage.role && message.content === templateMessage.content,
      ),
    );
    finalWorkspace.messages = [...copy(workspace.messages), ...additionalMessages];
    finalWorkspace.active_job = null;
    return finalWorkspace;
  }

  private buildClarifyingWorkspace(finalWorkspace: WorkspaceDetail): WorkspaceDetail {
    const question = this.scenario.clarification?.question;
    if (!question) return copy(finalWorkspace);
    const systemEvent = finalWorkspace.messages.find((message) => message.role === "system_event");
    return {
      ...copy(finalWorkspace),
      state: "clarifying",
      confirmed_constraints: [],
      messages: [
        copy(finalWorkspace.messages[0]),
        ...(systemEvent ? [copy(systemEvent)] : []),
        {
          id: "mock-message-clarification-001",
          role: "assistant",
          content: question,
          created_at: MOCK_NOW,
        },
      ],
      active_job: null,
      artifact: null,
    };
  }

  private persist(): void {
    if (!this.storage) return;
    const state: PersistedMockState = {
      version: 1,
      collection: copy(this.collection),
      workspaces: [...this.workspaces.entries()].map(([id, workspace]) => [id, copy(workspace)]),
      jobs: [...this.jobs.entries()].map(([id, job]) => [id, copy(job)]),
      workspaceCounter: this.workspaceCounter,
      jobCounter: this.jobCounter,
    };
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(state));
    } catch {
      // Storage may be unavailable in private browsing; the in-memory flow still works.
    }
  }

  private nextJobId(): string {
    this.jobCounter += 1;
    return `mock-job-${String(this.jobCounter).padStart(3, "0")}`;
  }

  private createJob(id: string, kind: string, videoId: string | null = null): JobCard {
    const job: JobCard = {
      id,
      kind,
      status: "queued",
      video_id: videoId,
      attempts: 0,
      last_error: null,
      created_at: "2026-07-21T12:00:00+08:00",
      updated_at: "2026-07-21T12:00:00+08:00",
      latest_event: null,
    };
    this.jobs.set(id, job);
    return job;
  }

  private requireWorkspace(id: string): WorkspaceDetail {
    const workspace = this.workspaces.get(id);
    if (!workspace) throw new Error(`Mock Workspace 不存在：${id}`);
    return workspace;
  }

  private findArtifact(id: string): { workspaceId: string; workspace: WorkspaceDetail } {
    for (const [workspaceId, workspace] of this.workspaces) {
      if (workspace.artifact?.id === id) return { workspaceId, workspace: copy(workspace) };
    }
    throw new Error(`Mock Artifact 不存在：${id}`);
  }

  private findWorkspaceByJob(id: string): { workspaceId: string; workspace: WorkspaceDetail } | null {
    for (const [workspaceId, workspace] of this.workspaces) {
      if (workspace.active_job?.id === id) return { workspaceId, workspace };
    }
    return null;
  }

  private finishWorkspace(id: string, finalWorkspace: WorkspaceDetail): void {
    const next = copy(finalWorkspace);
    next.active_job = null;
    this.workspaces.set(id, next);
    this.updateRecentWorkspace(next);
  }

  private updateRecentWorkspace(workspace: WorkspaceDetail): void {
    const card = {
      id: workspace.id,
      title: workspace.generated_title,
      state: workspace.state,
      updated_at: workspace.updated_at,
    };
    this.collection.recent_workspaces = [
      card,
      ...this.collection.recent_workspaces.filter((entry) => entry.id !== workspace.id),
    ].slice(0, 5);
  }
}
