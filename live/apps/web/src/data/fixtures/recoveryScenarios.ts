import type { JobEventCard, WorkspaceDetail } from "../../contracts";
import { happyPathScenario } from "./happyPath";
import type { MockScenario, MockScenarioKey } from "./types";

const FAILED_AT = "2026-07-21T12:00:06+08:00";

function event(
  sequence: number,
  stage: string,
  progress: number,
  message: string,
): JobEventCard {
  return {
    sequence,
    stage,
    progress,
    message,
    created_at: `2026-07-21T12:00:${String(sequence).padStart(2, "0")}+08:00`,
  };
}

function cloneScenario(key: MockScenarioKey, notice: string): MockScenario {
  const scenario = structuredClone(happyPathScenario);
  scenario.key = key;
  scenario.collection.notice = notice;
  scenario.clarification = null;
  scenario.failure = null;
  scenario.retryJobEvents = [];
  scenario.recoveryWorkspaceTemplate = null;
  return scenario;
}

function failedWorkspace(message: string, keepDecisions = false): WorkspaceDetail {
  const workspace = structuredClone(happyPathScenario.workspaceTemplate);
  workspace.state = "failed";
  workspace.active_job = null;
  workspace.artifact = null;
  workspace.updated_at = FAILED_AT;
  if (!keepDecisions) {
    workspace.adopted_videos = [];
    workspace.excluded_videos = [];
    workspace.confirmed_constraints = [];
  }
  workspace.messages = [
    structuredClone(happyPathScenario.workspaceTemplate.messages[0]!),
    {
      id: `mock-message-failure-${message.length}`,
      role: "system_event",
      content: message,
      created_at: FAILED_AT,
    },
  ];
  return workspace;
}

function recoveryTemplate(): WorkspaceDetail {
  return structuredClone(happyPathScenario.workspaceTemplate);
}

export const processingScenario = (() => {
  const scenario = cloneScenario(
    "processing",
    "Mock 处理中场景：任务保持运行，用于验证后台状态和刷新恢复。",
  );
  scenario.collection.videos = scenario.collection.videos.map((video) => ({
    ...video,
    status: "processing",
    purpose_line: null,
    summary: null,
  }));
  scenario.jobEvents = [
    event(1, "resolving_scope", 15, "正在继承收藏范围。"),
    event(2, "selecting_sources", 35, "正在选择与目标相关的视频。"),
    event(3, "compiling", 75, "后台仍在编译，离开页面后会继续。"),
  ];
  return scenario;
})();

export const parseFailedScenario = (() => {
  const scenario = cloneScenario(
    "parse_failed",
    "Mock 解析失败场景：保留原视频与目标，允许从原工作区重试。",
  );
  scenario.collection.videos[0] = {
    ...scenario.collection.videos[0]!,
    status: "failed",
    purpose_line: null,
    summary: null,
    error_code: "video_parse_failed",
    error_message: "这条视频尚未完成解析，不能作为本次成果依据。",
  };
  const message = "相关视频解析失败，本次没有生成任务卡；原视频和目标均已保留。";
  scenario.workspaceTemplate = failedWorkspace(message);
  scenario.failure = { code: "video_parse_failed", message, retryable: true };
  scenario.recoveryWorkspaceTemplate = recoveryTemplate();
  scenario.jobEvents = [
    event(1, "resolving_scope", 15, "正在检查收藏范围。"),
    event(2, "selecting_sources", 35, "发现关键视频尚未完成解析。"),
    event(3, "failed", 40, message),
  ];
  scenario.retryJobEvents = [
    event(4, "retrying", 45, "正在从原工作区重新检查视频。"),
    event(5, "selecting_sources", 60, "解析已恢复，正在重新选择来源。"),
    event(6, "compiling", 78, "正在编译现场拍摄任务卡。"),
    event(7, "validating_provenance", 92, "正在重新校验关键来源。"),
    event(8, "completed", 100, "恢复完成，任务卡已通过来源校验。"),
  ];
  return scenario;
})();

export const providerBlockedScenario = (() => {
  const scenario = cloneScenario(
    "provider_blocked",
    "Mock 配置阻塞场景：不会循环重试，也不会回退到成功数据。",
  );
  scenario.ready.status = "not_ready";
  scenario.ready.job_runner = { ok: false, detail: "Provider configuration required" };
  scenario.providers.ark = {
    configured: false,
    required_from_gate: "T1",
    detail: "缺少模型供应商配置",
  };
  scenario.collection.videos = scenario.collection.videos.map((video) => ({
    ...video,
    status: "needs_configuration",
    purpose_line: null,
    summary: null,
    error_code: "provider_not_configured",
    error_message: "需要完成模型供应商配置后继续。",
  }));
  const message = "模型供应商尚未配置，本次任务已阻塞；系统不会自动循环重试。";
  scenario.workspaceTemplate = failedWorkspace(message);
  scenario.failure = { code: "provider_not_configured", message, retryable: false };
  scenario.jobEvents = [
    event(1, "validating", 10, "正在检查本地服务与模型供应商。"),
    event(2, "blocked", 10, message),
  ];
  return scenario;
})();

export const artifactValidationFailedScenario = (() => {
  const scenario = cloneScenario(
    "artifact_validation_failed",
    "Mock 来源校验失败场景：不发布缺少依据的行动项。",
  );
  const message = "任务卡来源校验失败，本次版本未发布；页面不会展示无依据行动项。";
  scenario.workspaceTemplate = failedWorkspace(message, true);
  scenario.failure = { code: "artifact_validation_failed", message, retryable: true };
  scenario.recoveryWorkspaceTemplate = recoveryTemplate();
  scenario.jobEvents = [
    event(1, "resolving_scope", 15, "正在继承收藏范围。"),
    event(2, "selecting_sources", 35, "已选择与目标相关的视频。"),
    event(3, "compiling", 75, "正在编译现场拍摄任务卡。"),
    event(4, "validating_provenance", 90, "正在校验每个关键行动项的来源。"),
    event(5, "failed", 90, message),
  ];
  scenario.retryJobEvents = [
    event(6, "retrying", 60, "正在从原工作区重新编译。"),
    event(7, "compiling", 78, "正在移除无法验证的行动项。"),
    event(8, "validating_provenance", 94, "正在重新校验剩余来源。"),
    event(9, "completed", 100, "恢复完成，任务卡已通过来源校验。"),
  ];
  return scenario;
})();

export const insufficientScopeScenario = (() => {
  const scenario = cloneScenario(
    "insufficient_scope",
    "Mock 范围证据不足场景：只在用户确认后扩大候选范围。",
  );
  const message = "当前小类没有视频能直接支撑任务卡，请选择是否扩大收藏范围。";
  scenario.workspaceTemplate = failedWorkspace(message);
  scenario.workspaceTemplate.launch_scope = {
    mode: "subcategory",
    category_id: "mock-subcategory-target-scene",
    video_ids: [],
  };
  scenario.workspaceTemplate.scope_expansion_options = [
    { target: "parent", label: "扩大到上一级“摄影实战”", candidate_count: 4 },
    { target: "home", label: "使用全部收藏继续查找", candidate_count: 4 },
  ];
  scenario.failure = { code: "insufficient_scope_evidence", message, retryable: true };
  scenario.recoveryWorkspaceTemplate = recoveryTemplate();
  scenario.jobEvents = [
    event(1, "resolving_scope", 15, "正在继承当前小类。"),
    event(2, "selecting_sources", 35, "当前小类没有直接支持目标的内容。"),
    event(3, "failed", 40, message),
  ];
  scenario.retryJobEvents = [
    event(4, "resolving_scope", 20, "已按用户选择扩大收藏范围。"),
    event(5, "selecting_sources", 45, "正在从扩大后的范围重新选择来源。"),
    event(6, "compiling", 78, "正在编译现场拍摄任务卡。"),
    event(7, "validating_provenance", 94, "正在校验关键来源。"),
    event(8, "completed", 100, "范围扩大后已完成任务卡。"),
  ];
  return scenario;
})();

export const emptyCollectionScenario = (() => {
  const scenario = cloneScenario(
    "empty_collection",
    "Mock 空收藏场景：没有内容时不创建工作区，也不生成成果。",
  );
  scenario.collection.videos = [];
  scenario.collection.categories = [];
  scenario.collection.recent_workspaces = [];
  scenario.categories = {};
  scenario.workspaceTemplate = failedWorkspace("收藏夹没有可用视频，尚未创建工作区。");
  scenario.jobEvents = [];
  scenario.provenance = {};
  return scenario;
})();
