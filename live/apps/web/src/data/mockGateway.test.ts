import { describe, expect, it } from "vitest";

import type { JobEventCard } from "../contracts";
import { GatewayRequestError } from "./gateway";
import { MockGateway, immediateMockScheduler } from "./mockGateway";
import type { MockKeyValueStorage } from "./mockStore";

class MemoryStorage implements MockKeyValueStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function finishJob(gateway: MockGateway, jobId: string): Promise<JobEventCard[]> {
  return new Promise((resolve, reject) => {
    const events: JobEventCard[] = [];
    gateway.subscribeJob(
      jobId,
      {
        onEvent: (event) => events.push(event),
        onError: reject,
        onClose: () => resolve(events),
      },
      0,
    );
  });
}

describe("MockGateway happy path", () => {
  it("runs workspace creation through deterministic job events and restores it from collection", async () => {
    const gateway = new MockGateway({ scheduler: immediateMockScheduler, eventDelayMs: 0 });
    const created = await gateway.createWorkspace({
      goal: "把相关教程变成现场拍摄任务卡",
      launch_scope: { mode: "home", category_id: null, video_ids: [] },
    });

    expect(created.state).toBe("forming");
    expect((await gateway.getWorkspace(created.workspace_id)).artifact).toBeNull();

    const events = await finishJob(gateway, created.job_id);
    const workspace = await gateway.getWorkspace(created.workspace_id);
    const collection = await gateway.getCollection();

    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(workspace.state).toBe("ready");
    expect(workspace.artifact?.kind).toBe("shooting_task_card");
    expect(collection.recent_workspaces[0]?.id).toBe(created.workspace_id);
    expect((await gateway.getJob(created.job_id)).status).toBe("completed");
  });

  it("recovers an in-flight workspace after the mock gateway is recreated", async () => {
    const storage = new MemoryStorage();
    const firstGateway = new MockGateway({ storage });
    const created = await firstGateway.createWorkspace({
      goal: "刷新后继续生成现场任务卡",
      launch_scope: { mode: "home", category_id: null, video_ids: [] },
    });

    const recoveredGateway = new MockGateway({
      storage,
      scheduler: immediateMockScheduler,
      eventDelayMs: 0,
    });
    expect((await recoveredGateway.getWorkspace(created.workspace_id)).original_goal).toBe(
      "刷新后继续生成现场任务卡",
    );
    expect((await recoveredGateway.getCollection()).recent_workspaces[0]?.state).toBe("forming");

    await finishJob(recoveredGateway, created.job_id);
    const afterSecondRefresh = new MockGateway({ storage });
    expect((await afterSecondRefresh.getWorkspace(created.workspace_id)).state).toBe("ready");
    expect((await afterSecondRefresh.getWorkspace(created.workspace_id)).artifact).not.toBeNull();
  });

  it("asks at most one clarification and continues the same workspace", async () => {
    const gateway = new MockGateway({
      scenario: "clarification_once",
      scheduler: immediateMockScheduler,
      eventDelayMs: 0,
    });
    const created = await gateway.createWorkspace({
      goal: "把收藏变成现场可执行任务卡",
      launch_scope: { mode: "home", category_id: null, video_ids: [] },
    });
    await finishJob(gateway, created.job_id);

    const clarifying = await gateway.getWorkspace(created.workspace_id);
    const question = clarifying.messages.filter(
      (message) => message.role === "assistant" && message.content.endsWith("？"),
    );
    expect(clarifying.state).toBe("clarifying");
    expect(clarifying.artifact).toBeNull();
    expect(question).toHaveLength(1);

    const continued = await gateway.sendMessage(created.workspace_id, { text: "优先快速执行" });
    expect(continued.workspace_id).toBe(created.workspace_id);
    await finishJob(gateway, continued.job_id);
    const ready = await gateway.getWorkspace(created.workspace_id);

    expect(ready.state).toBe("ready");
    expect(ready.messages.filter((message) => message.content.endsWith("？"))).toHaveLength(1);
    expect(ready.messages.some((message) => message.content === "优先快速执行")).toBe(true);
  });

  it("keeps checklist state separate from artifact content version", async () => {
    const gateway = new MockGateway({ scheduler: immediateMockScheduler, eventDelayMs: 0 });
    const created = await gateway.createWorkspace({
      goal: "生成现场拍摄任务卡",
      launch_scope: { mode: "home", category_id: null, video_ids: [] },
    });
    await finishJob(gateway, created.job_id);
    const before = await gateway.getWorkspace(created.workspace_id);
    const artifact = before.artifact;
    if (!artifact) throw new Error("expected artifact");
    const item = artifact.sections[0]?.items[0];
    if (!item) throw new Error("expected artifact item");

    await gateway.checkArtifactItem(artifact.id, item.id, { checked: true });
    const after = await gateway.getWorkspace(created.workspace_id);

    expect(after.artifact?.version).toBe(artifact.version);
    expect(after.artifact?.sections[0]?.items[0]?.checked).toBe(true);
  });

  it("revises the same artifact and preserves provenance", async () => {
    const gateway = new MockGateway({ scheduler: immediateMockScheduler, eventDelayMs: 0 });
    const created = await gateway.createWorkspace({
      goal: "生成现场拍摄任务卡",
      launch_scope: { mode: "home", category_id: null, video_ids: [] },
    });
    await finishJob(gateway, created.job_id);
    const before = await gateway.getWorkspace(created.workspace_id);
    const artifact = before.artifact;
    if (!artifact) throw new Error("expected artifact");
    const provenanceBefore = artifact.sections.flatMap((section) =>
      section.items.flatMap((item) => item.provenance_ids),
    );

    const revision = await gateway.reviseArtifact(artifact.id, {
      instruction: "压缩成拍摄现场能看完的一屏小纸条",
    });
    await finishJob(gateway, revision.job_id);
    const after = await gateway.getWorkspace(created.workspace_id);
    const provenanceAfter = after.artifact?.sections.flatMap((section) =>
      section.items.flatMap((item) => item.provenance_ids),
    );

    expect(after.artifact?.id).toBe(artifact.id);
    expect(after.artifact?.version).toBe(artifact.version + 1);
    expect(after.artifact?.compact_variant?.lines.length).toBeGreaterThan(0);
    expect(after.artifact?.compact_variant?.lines.length).toBeLessThanOrEqual(8);
    expect(provenanceAfter).toEqual(provenanceBefore);
    expect((await gateway.getProvenance(provenanceBefore[0] ?? "")).kind).toMatch(/video|inference/);
  });

  it("keeps the original artifact when a revision request is rejected", async () => {
    const gateway = new MockGateway({ scheduler: immediateMockScheduler, eventDelayMs: 0 });
    const created = await gateway.createWorkspace({
      goal: "生成现场任务卡",
      launch_scope: { mode: "home", category_id: null, video_ids: [] },
    });
    await finishJob(gateway, created.job_id);
    const before = await gateway.getWorkspace(created.workspace_id);
    if (!before.artifact) throw new Error("expected artifact");

    await expect(gateway.reviseArtifact(before.artifact.id, { instruction: "   " })).rejects.toThrow();
    const after = await gateway.getWorkspace(created.workspace_id);

    expect(after.artifact?.id).toBe(before.artifact.id);
    expect(after.artifact?.version).toBe(before.artifact.version);
    expect(after.artifact?.sections).toEqual(before.artifact.sections);
  });
});

describe("MockGateway U4 recovery scenarios", () => {
  it("keeps processing in-flight and restores its latest event", async () => {
    const storage = new MemoryStorage();
    const gateway = new MockGateway({
      scenario: "processing",
      scheduler: immediateMockScheduler,
      eventDelayMs: 0,
      storage,
    });
    const created = await gateway.createWorkspace({
      goal: "生成仍在后台处理的任务卡",
      launch_scope: { mode: "home", category_id: null, video_ids: [] },
    });
    const events = await finishJob(gateway, created.job_id);
    const processing = await gateway.getWorkspace(created.workspace_id);

    expect(events.at(-1)?.stage).toBe("compiling");
    expect(processing.state).toBe("forming");
    expect(processing.artifact).toBeNull();
    expect((await gateway.getJob(created.job_id)).status).toBe("running");

    const recovered = new MockGateway({ scenario: "processing", storage });
    expect((await recovered.getWorkspace(created.workspace_id)).active_job?.latest_event?.sequence).toBe(3);
  });

  it.each(["parse_failed", "artifact_validation_failed"] as const)(
    "keeps %s honest, then retries inside the same workspace",
    async (scenario) => {
      const gateway = new MockGateway({ scenario, scheduler: immediateMockScheduler, eventDelayMs: 0 });
      const created = await gateway.createWorkspace({
        goal: "失败后从原工作区恢复",
        launch_scope: { mode: "home", category_id: null, video_ids: [] },
      });
      const firstEvents = await finishJob(gateway, created.job_id);
      const failed = await gateway.getWorkspace(created.workspace_id);

      expect(firstEvents.at(-1)?.stage).toBe("failed");
      expect(failed.state).toBe("failed");
      expect(failed.artifact).toBeNull();
      expect(failed.active_job?.status).toBe("failed");

      const retried = await gateway.retryJob(created.job_id);
      expect(retried.id).toBe(created.job_id);
      expect(retried.attempts).toBe(1);
      await finishJob(gateway, created.job_id);

      const recovered = await gateway.getWorkspace(created.workspace_id);
      const collection = await gateway.getCollection();
      expect(recovered.id).toBe(created.workspace_id);
      expect(recovered.state).toBe("ready");
      expect(recovered.artifact?.kind).toBe("shooting_task_card");
      expect(collection.recent_workspaces.filter((entry) => entry.id === created.workspace_id)).toHaveLength(1);
    },
  );

  it("keeps provider blockage terminal and non-retryable", async () => {
    const gateway = new MockGateway({
      scenario: "provider_blocked",
      scheduler: immediateMockScheduler,
      eventDelayMs: 0,
    });
    const created = await gateway.createWorkspace({
      goal: "验证配置阻塞不会伪造成功",
      launch_scope: { mode: "home", category_id: null, video_ids: [] },
    });
    await finishJob(gateway, created.job_id);
    const blocked = await gateway.getWorkspace(created.workspace_id);

    expect(blocked.state).toBe("failed");
    expect(blocked.active_job?.status).toBe("blocked");
    expect(blocked.artifact).toBeNull();
    await expect(gateway.retryJob(created.job_id)).rejects.toBeInstanceOf(GatewayRequestError);
    await expect(gateway.retryJob(created.job_id)).rejects.toMatchObject({
      code: "provider_not_configured",
      retryable: false,
    });
  });

  it("expands insufficient scope only after consent and keeps the same workspace", async () => {
    const gateway = new MockGateway({
      scenario: "insufficient_scope",
      scheduler: immediateMockScheduler,
      eventDelayMs: 0,
    });
    const created = await gateway.createWorkspace({
      goal: "把当前小类教程编译成现场任务卡",
      launch_scope: {
        mode: "subcategory",
        category_id: "mock-subcategory-target-scene",
        video_ids: [],
      },
    });
    await finishJob(gateway, created.job_id);

    const failed = await gateway.getWorkspace(created.workspace_id);
    expect(failed.state).toBe("failed");
    expect(failed.artifact).toBeNull();
    expect(failed.scope_expansion_options.map((option) => option.target)).toEqual(["parent", "home"]);

    const expanded = await gateway.expandWorkspaceScope(created.workspace_id, { target: "parent" });
    expect(expanded.workspace_id).toBe(created.workspace_id);
    expect(expanded.job_id).not.toBe(created.job_id);
    expect((await gateway.getJob(expanded.job_id)).kind).toBe("expand_workspace_scope");
    await finishJob(gateway, expanded.job_id);

    const ready = await gateway.getWorkspace(created.workspace_id);
    expect(ready.state).toBe("ready");
    expect(ready.launch_scope).toEqual({
      mode: "major",
      category_id: "mock-category-photo",
      video_ids: [],
    });
    expect(ready.scope_expansion_options).toEqual([]);
    expect(ready.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "system_event",
          content: "用户确认扩大到上一级“摄影实战”；已重新锁定 4 条候选内容。",
        }),
      ]),
    );
    await expect(
      gateway.expandWorkspaceScope(created.workspace_id, { target: "home" }),
    ).rejects.toMatchObject({ code: "scope_expansion_not_available", retryable: false });
  });

  it("returns a truly empty collection without hidden success data", async () => {
    const gateway = new MockGateway({ scenario: "empty_collection" });
    const collection = await gateway.getCollection();

    expect(collection.videos).toEqual([]);
    expect(collection.categories).toEqual([]);
    expect(collection.recent_workspaces).toEqual([]);
  });
});
