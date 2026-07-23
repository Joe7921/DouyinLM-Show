import { api, fetchJson } from "../api";
import type {
  CheckArtifactItemRequest,
  CreateWorkspaceRequest,
  ExpandWorkspaceScopeRequest,
  JobEventHandlers,
  JobEventSubscription,
  ReviseArtifactRequest,
  SendMessageRequest,
} from "../contracts";
import {
  parseAsyncWorkspaceResponse,
  parseCategoryDetail,
  parseCheckArtifactItemResponse,
  parseJobCard,
  parseJobEventCard,
  parseProvenanceDetail,
  parseReviseArtifactResponse,
  parseWorkspaceDetail,
} from "../contracts/parsers";
import type { DouyinLMGateway } from "./gateway";

const TERMINAL_EVENT_STAGES = new Set(["ready", "completed", "failed", "blocked"]);

function jsonRequest(method: "POST" | "PATCH", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export class LiveGateway implements DouyinLMGateway {
  readonly mode = "live" as const;

  getReady = api.ready;
  getProviders = api.providers;
  getCollection = api.collection;
  getJobs = api.jobs;
  retryJob = api.retryJob;
  reanalyzeVideo = api.reanalyzeVideo;
  importVideos = api.importVideos;

  async getCategory(id: string) {
    const value = await fetchJson<unknown>(`/api/categories/${encodeURIComponent(id)}`);
    return parseCategoryDetail(value);
  }

  async createWorkspace(input: CreateWorkspaceRequest) {
    const value = await fetchJson<unknown>("/api/workspaces", jsonRequest("POST", input));
    return parseAsyncWorkspaceResponse(value);
  }

  async sendMessage(id: string, input: SendMessageRequest) {
    const value = await fetchJson<unknown>(
      `/api/workspaces/${encodeURIComponent(id)}/messages`,
      jsonRequest("POST", input),
    );
    return parseAsyncWorkspaceResponse(value);
  }

  async expandWorkspaceScope(id: string, input: ExpandWorkspaceScopeRequest) {
    const value = await fetchJson<unknown>(
      `/api/workspaces/${encodeURIComponent(id)}/scope-expansions`,
      jsonRequest("POST", input),
    );
    return parseAsyncWorkspaceResponse(value);
  }

  async getWorkspace(id: string) {
    const value = await fetchJson<unknown>(`/api/workspaces/${encodeURIComponent(id)}`);
    return parseWorkspaceDetail(value);
  }

  async reviseArtifact(id: string, input: ReviseArtifactRequest) {
    const value = await fetchJson<unknown>(
      `/api/artifacts/${encodeURIComponent(id)}/revisions`,
      jsonRequest("POST", input),
    );
    return parseReviseArtifactResponse(value);
  }

  async checkArtifactItem(artifactId: string, itemId: string, input: CheckArtifactItemRequest) {
    const value = await fetchJson<unknown>(
      `/api/artifacts/${encodeURIComponent(artifactId)}/items/${encodeURIComponent(itemId)}`,
      jsonRequest("PATCH", input),
    );
    return parseCheckArtifactItemResponse(value);
  }

  async getProvenance(id: string) {
    const value = await fetchJson<unknown>(`/api/provenance/${encodeURIComponent(id)}`);
    return parseProvenanceDetail(value);
  }

  async getJob(id: string) {
    const value = await fetchJson<unknown>(`/api/jobs/${encodeURIComponent(id)}`);
    return parseJobCard(value);
  }

  subscribeJob(id: string, handlers: JobEventHandlers, afterSequence = 0): JobEventSubscription {
    const source = new EventSource(`/api/jobs/${encodeURIComponent(id)}/events`);
    let closed = false;

    const close = () => {
      if (closed) return;
      closed = true;
      source.close();
      handlers.onClose?.();
    };

    source.addEventListener("progress", (rawEvent) => {
      if (closed) return;
      try {
        const message = rawEvent as MessageEvent<string>;
        const event = parseJobEventCard(JSON.parse(message.data));
        if (event.sequence <= afterSequence) return;
        handlers.onEvent(event);
        if (TERMINAL_EVENT_STAGES.has(event.stage)) close();
      } catch (error) {
        handlers.onError?.(error instanceof Error ? error : new Error("无法解析任务事件"));
        close();
      }
    });

    source.onerror = () => {
      if (!closed) handlers.onError?.(new Error("任务事件连接暂时中断"));
    };

    return { close };
  }
}

export const liveGateway = new LiveGateway();
