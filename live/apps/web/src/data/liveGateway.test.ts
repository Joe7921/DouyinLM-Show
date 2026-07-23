import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "../api";
import type { JobEventCard } from "../contracts";
import { ContractParseError } from "../contracts/parsers";
import { happyPathScenario } from "./fixtures";
import { LiveGateway } from "./liveGateway";

const CREATED_AT = "2026-07-22T08:00:00+08:00";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return `${input.pathname}${input.search}`;
  return input.url;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LiveGateway P0 transport contract", () => {
  it("uses the frozen P0 routes and parses every response through the shared contracts", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const workspace = structuredClone(happyPathScenario.workspaceTemplate);
    const category = structuredClone(happyPathScenario.categories["mock-category-photo"]!);
    const provenance = structuredClone(happyPathScenario.provenance["mock-prov-video-001"]!);
    const job = {
      id: "live-job-001",
      kind: "compile_collection_artifact",
      status: "running",
      video_id: null,
      attempts: 0,
      last_error: null,
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
      latest_event: null,
    };
    const responses = new Map<string, unknown>([
      ["/api/categories/category%2Fphoto", category],
      ["/api/workspaces", { workspace_id: workspace.id, job_id: job.id, state: "forming" }],
      [
        "/api/workspaces/workspace%2Falpha/messages",
        { workspace_id: workspace.id, job_id: job.id, state: "compiling" },
      ],
      [
        "/api/workspaces/workspace%2Falpha/scope-expansions",
        { workspace_id: workspace.id, job_id: job.id, state: "forming" },
      ],
      ["/api/workspaces/workspace%2Falpha", workspace],
      [
        "/api/artifacts/artifact%2Falpha/revisions",
        { artifact_id: "artifact/alpha", job_id: job.id, version_before: 1 },
      ],
      [
        "/api/artifacts/artifact%2Falpha/items/item%2Fone",
        { artifact_id: "artifact/alpha", item_id: "item/one", checked: true, updated_at: CREATED_AT },
      ],
      ["/api/provenance/provenance%2Fone", provenance],
      ["/api/jobs/job%2Fone", job],
    ]);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      calls.push({ url, init });
      const value = responses.get(url);
      return value === undefined
        ? jsonResponse({ code: "not_found", message: "未找到", retryable: false }, 404)
        : jsonResponse(value);
    });

    const gateway = new LiveGateway();
    const createInput = {
      goal: "把收藏变成现场拍摄任务卡",
      launch_scope: { mode: "home" as const, category_id: null, video_ids: [] },
    };
    await gateway.getCategory("category/photo");
    await gateway.createWorkspace(createInput);
    await gateway.sendMessage("workspace/alpha", { text: "优先快速执行" });
    await gateway.expandWorkspaceScope("workspace/alpha", { target: "parent" });
    await gateway.getWorkspace("workspace/alpha");
    await gateway.reviseArtifact("artifact/alpha", { instruction: "压缩成一屏小纸条" });
    await gateway.checkArtifactItem("artifact/alpha", "item/one", { checked: true });
    await gateway.getProvenance("provenance/one");
    await gateway.getJob("job/one");

    expect(calls.map((call) => call.url)).toEqual([...responses.keys()]);
    expect(calls.map((call) => call.init?.method ?? "GET")).toEqual([
      "GET",
      "POST",
      "POST",
      "POST",
      "GET",
      "POST",
      "PATCH",
      "GET",
      "GET",
    ]);
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual(createInput);
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ text: "优先快速执行" });
    expect(JSON.parse(String(calls[3]?.init?.body))).toEqual({ target: "parent" });
    expect(JSON.parse(String(calls[5]?.init?.body))).toEqual({ instruction: "压缩成一屏小纸条" });
    expect(JSON.parse(String(calls[6]?.init?.body))).toEqual({ checked: true });
  });

  it("keeps a real API failure visible and never falls back to Mock", async () => {
    const fetchStub = vi.fn(async () =>
      jsonResponse(
        { code: "provider_not_configured", message: "模型供应商尚未配置", retryable: false },
        503,
      ),
    );
    vi.stubGlobal("fetch", fetchStub);

    const gateway = new LiveGateway();
    const request = gateway.createWorkspace({
      goal: "生成现场任务卡",
      launch_scope: { mode: "home", category_id: null, video_ids: [] },
    });

    await expect(request).rejects.toBeInstanceOf(ApiRequestError);
    await expect(
      gateway.getWorkspace("missing"),
    ).rejects.toMatchObject({ code: "provider_not_configured", retryable: false });
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it("fails fast when a live response drifts from the frozen schema", async () => {
    const invalid = structuredClone(happyPathScenario.workspaceTemplate) as Record<string, unknown>;
    delete invalid.launch_scope;
    vi.stubGlobal("fetch", async () => jsonResponse(invalid));

    await expect(new LiveGateway().getWorkspace("workspace-alpha")).rejects.toBeInstanceOf(
      ContractParseError,
    );
  });
});

describe("LiveGateway SSE contract", () => {
  it("filters replayed events and closes on a terminal event", () => {
    class FakeEventSource {
      static latest: FakeEventSource | null = null;
      readonly url: string;
      onerror: (() => void) | null = null;
      closed = false;
      private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

      constructor(url: string) {
        this.url = url;
        FakeEventSource.latest = this;
      }

      addEventListener(type: string, listener: (event: unknown) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
      }

      close() {
        this.closed = true;
      }

      emit(type: string, value: JobEventCard) {
        for (const listener of this.listeners.get(type) ?? []) {
          listener({ data: JSON.stringify(value) });
        }
      }
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    const events: JobEventCard[] = [];
    const onClose = vi.fn();
    const gateway = new LiveGateway();
    gateway.subscribeJob(
      "job/one",
      { onEvent: (event) => events.push(event), onClose },
      4,
    );
    const source = FakeEventSource.latest;
    if (!source) throw new Error("expected EventSource");

    source.emit("progress", {
      sequence: 4,
      stage: "compiling",
      progress: 75,
      message: "重复事件",
      created_at: CREATED_AT,
    });
    source.emit("progress", {
      sequence: 5,
      stage: "completed",
      progress: 100,
      message: "已完成",
      created_at: CREATED_AT,
    });

    expect(source.url).toBe("/api/jobs/job%2Fone/events");
    expect(events.map((event) => event.sequence)).toEqual([5]);
    expect(source.closed).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
