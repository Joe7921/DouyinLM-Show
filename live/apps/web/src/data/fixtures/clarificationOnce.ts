import type { MockScenario } from "./types";
import { happyPathScenario } from "./happyPath";

const scenario = structuredClone(happyPathScenario);
scenario.key = "clarification_once";
scenario.collection.notice = "Mock 单次追问场景，用于验证必要澄清后继续同一工作区。";
scenario.workspaceTemplate.generated_title = "目标场景拍摄 · 快速执行版";
scenario.workspaceTemplate.confirmed_constraints = ["优先快速执行", "只保留现场能立即判断的步骤"];
scenario.clarification = {
  question: "你到现场时更需要快速执行，还是希望保留完整参数细节？",
};

export const clarificationOnceScenario: MockScenario = scenario;
