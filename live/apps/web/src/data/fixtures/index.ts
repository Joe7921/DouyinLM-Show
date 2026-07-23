import { happyPathScenario } from "./happyPath";
import { clarificationOnceScenario } from "./clarificationOnce";
import {
  artifactValidationFailedScenario,
  emptyCollectionScenario,
  insufficientScopeScenario,
  parseFailedScenario,
  processingScenario,
  providerBlockedScenario,
} from "./recoveryScenarios";
import type { MockScenario, MockScenarioKey } from "./types";

export const REQUIRED_MOCK_SCENARIOS: readonly MockScenarioKey[] = [
  "happy_path",
  "clarification_once",
  "processing",
  "parse_failed",
  "provider_blocked",
  "artifact_validation_failed",
  "insufficient_scope",
  "empty_collection",
];

const registry: Partial<Record<MockScenarioKey, MockScenario>> = {
  happy_path: happyPathScenario,
  clarification_once: clarificationOnceScenario,
  processing: processingScenario,
  parse_failed: parseFailedScenario,
  provider_blocked: providerBlockedScenario,
  artifact_validation_failed: artifactValidationFailedScenario,
  insufficient_scope: insufficientScopeScenario,
  empty_collection: emptyCollectionScenario,
};

export function getMockScenario(key: MockScenarioKey): MockScenario {
  const scenario = registry[key];
  if (!scenario) throw new Error(`Mock 场景尚未在当前 Gate 实现：${key}`);
  return scenario;
}

export {
  artifactValidationFailedScenario,
  clarificationOnceScenario,
  emptyCollectionScenario,
  happyPathScenario,
  insufficientScopeScenario,
  parseFailedScenario,
  processingScenario,
  providerBlockedScenario,
};
export type { FixtureOrigin, MockFailure, MockScenario, MockScenarioKey } from "./types";
