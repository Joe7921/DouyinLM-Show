import { createContext, type ReactNode, useContext, useMemo } from "react";

import type { DouyinLMGateway } from "./gateway";
import { liveGateway } from "./liveGateway";
import { MockGateway } from "./mockGateway";
import type { MockScenarioKey } from "./fixtures";

const GatewayContext = createContext<DouyinLMGateway | null>(null);

export function resolveDataMode(env: ImportMetaEnv = import.meta.env): "live" | "mock" {
  if (env.PROD) return "live";
  return env.VITE_DATA_MODE === "mock" ? "mock" : "live";
}

export function createAppGateway(env: ImportMetaEnv = import.meta.env): DouyinLMGateway {
  if (hasExplicitMockOptIn()) {
    return new MockGateway({ scenario: "happy_path", storage: getSessionStorage() });
  }
  if (resolveDataMode(env) === "live") return liveGateway;
  const scenario = (env.VITE_MOCK_SCENARIO || "happy_path") as MockScenarioKey;
  return new MockGateway({ scenario, storage: getSessionStorage() });
}

function hasExplicitMockOptIn(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("demo") === "mock";
}

function getSessionStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function GatewayProvider({
  children,
  gateway,
}: {
  children: ReactNode;
  gateway?: DouyinLMGateway;
}) {
  const value = useMemo(() => gateway ?? createAppGateway(), [gateway]);
  return <GatewayContext.Provider value={value}>{children}</GatewayContext.Provider>;
}

export function useGateway(): DouyinLMGateway {
  const gateway = useContext(GatewayContext);
  if (!gateway) throw new Error("useGateway 必须在 GatewayProvider 内使用");
  return gateway;
}
