import {
  parseCollectionResponse,
  parseImportResponse,
  parseJobCard,
  parseJobListResponse,
  parseProvidersHealth,
  parseReadyHealth,
} from "./contracts/parsers";
import { GatewayRequestError } from "./data/gateway";

export class ApiRequestError extends GatewayRequestError {
  constructor(message: string, code = "request_failed", retryable = false) {
    super(message, code, retryable);
    this.name = "ApiRequestError";
  }
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { code?: string; message?: string; retryable?: boolean; detail?: string }
      | null;
    throw new ApiRequestError(
      body?.message ?? body?.detail ?? `请求失败：${response.status}`,
      body?.code,
      body?.retryable,
    );
  }

  return (await response.json()) as T;
}

export const api = {
  collection: () => fetchJson<unknown>("/api/collection").then(parseCollectionResponse),
  ready: () => fetchJson<unknown>("/api/health/ready").then(parseReadyHealth),
  providers: () => fetchJson<unknown>("/api/health/providers").then(parseProvidersHealth),
  jobs: () => fetchJson<unknown>("/api/jobs").then(parseJobListResponse),
  retryJob: (jobId: string) =>
    fetchJson<unknown>(`/api/jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST" }).then(parseJobCard),
  reanalyzeVideo: (videoId: string) =>
    fetchJson<unknown>(`/api/videos/${encodeURIComponent(videoId)}/reanalyze`, { method: "POST" }).then(parseJobCard),
  importVideos: (input: {
    files: File[];
    manifestJson: string;
    permissionScope: string;
  }) => {
    const form = new FormData();
    for (const file of input.files) form.append("files", file);
    form.append("manifest_json", input.manifestJson);
    form.append("permission_confirmed", "true");
    form.append("permission_scope", input.permissionScope);
    return fetchJson<unknown>("/api/videos/import", {
      method: "POST",
      body: form,
    }).then(parseImportResponse);
  },
};
