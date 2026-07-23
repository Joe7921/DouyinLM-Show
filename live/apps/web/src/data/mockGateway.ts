import {
  parseAsyncWorkspaceResponse,
  parseCategoryDetail,
  parseCheckArtifactItemResponse,
  parseCollectionResponse,
  parseImportResponse,
  parseJobCard,
  parseJobEventCard,
  parseJobListResponse,
  parseProvidersHealth,
  parseProvenanceDetail,
  parseReadyHealth,
  parseReviseArtifactResponse,
  parseWorkspaceDetail,
} from "../contracts/parsers";
import type {
  CheckArtifactItemRequest,
  CreateWorkspaceRequest,
  ExpandWorkspaceScopeRequest,
  JobEventHandlers,
  JobEventSubscription,
  ReviseArtifactRequest,
  SendMessageRequest,
} from "../contracts";
import { getMockScenario, type MockScenarioKey } from "./fixtures";
import type { DouyinLMGateway } from "./gateway";
import { MockStore, type MockKeyValueStorage } from "./mockStore";

export type MockScheduler = {
  wait: (milliseconds: number) => Promise<void>;
};

export const immediateMockScheduler: MockScheduler = {
  wait: () => Promise.resolve(),
};

const browserMockScheduler: MockScheduler = {
  wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

export class MockGateway implements DouyinLMGateway {
  readonly mode = "mock" as const;
  private readonly store: MockStore;
  private readonly scheduler: MockScheduler;
  private readonly eventDelayMs: number;

  constructor(options: {
    scenario?: MockScenarioKey;
    scheduler?: MockScheduler;
    eventDelayMs?: number;
    storage?: MockKeyValueStorage;
  } = {}) {
    const scenario = options.scenario ?? "happy_path";
    this.store = new MockStore(getMockScenario(scenario), {
      storage: options.storage,
      storageKey: `douyinlm.mock.v1.${scenario}`,
    });
    this.scheduler = options.scheduler ?? browserMockScheduler;
    this.eventDelayMs = options.eventDelayMs ?? 140;
  }

  async getReady() {
    return parseReadyHealth(this.store.getReady());
  }

  async getProviders() {
    return parseProvidersHealth(this.store.getProviders());
  }

  async getCollection() {
    return parseCollectionResponse(this.store.getCollection());
  }

  async getCategory(id: string) {
    return parseCategoryDetail(this.store.getCategory(id));
  }

  async createWorkspace(input: CreateWorkspaceRequest) {
    return parseAsyncWorkspaceResponse(this.store.createWorkspace(input));
  }

  async sendMessage(id: string, input: SendMessageRequest) {
    return parseAsyncWorkspaceResponse(this.store.sendMessage(id, input));
  }

  async expandWorkspaceScope(id: string, input: ExpandWorkspaceScopeRequest) {
    return parseAsyncWorkspaceResponse(this.store.expandWorkspaceScope(id, input));
  }

  async getWorkspace(id: string) {
    return parseWorkspaceDetail(this.store.getWorkspace(id));
  }

  async reviseArtifact(id: string, input: ReviseArtifactRequest) {
    return parseReviseArtifactResponse(this.store.reviseArtifact(id, input.instruction));
  }

  async checkArtifactItem(artifactId: string, itemId: string, input: CheckArtifactItemRequest) {
    return parseCheckArtifactItemResponse(this.store.checkArtifactItem(artifactId, itemId, input.checked));
  }

  async getProvenance(id: string) {
    return parseProvenanceDetail(this.store.getProvenance(id));
  }

  async getJobs() {
    return parseJobListResponse(this.store.getJobs());
  }

  async getJob(id: string) {
    return parseJobCard(this.store.getJob(id));
  }

  async retryJob(id: string) {
    return parseJobCard(this.store.retryJob(id));
  }

  async reanalyzeVideo(id: string) {
    return parseJobCard(this.store.reanalyzeVideo(id));
  }

  async importVideos(input: Parameters<DouyinLMGateway["importVideos"]>[0]) {
    return parseImportResponse(this.store.importVideos(input));
  }

  subscribeJob(id: string, handlers: JobEventHandlers, afterSequence = 0): JobEventSubscription {
    let closed = false;
    let closeReported = false;
    const reportClose = () => {
      if (closeReported) return;
      closeReported = true;
      handlers.onClose?.();
    };
    const close = () => {
      closed = true;
      reportClose();
    };

    void (async () => {
      try {
        for (const rawEvent of this.store.getJobEvents(id, afterSequence)) {
          await this.scheduler.wait(this.eventDelayMs);
          if (closed) return;
          const event = parseJobEventCard(rawEvent);
          this.store.applyJobEvent(id, event);
          handlers.onEvent(event);
          if (["completed", "ready", "failed", "blocked"].includes(event.stage)) break;
        }
      } catch (error) {
        handlers.onError?.(error instanceof Error ? error : new Error("Mock 任务推进失败"));
      } finally {
        closed = true;
        reportClose();
      }
    })();

    return { close };
  }
}
