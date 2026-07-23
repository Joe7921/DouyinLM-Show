import { describe, expect, it } from "vitest";

import { resolveDataMode } from "./gatewayContext";

function env(values: Partial<ImportMetaEnv>): ImportMetaEnv {
  return {
    BASE_URL: "/",
    MODE: "test",
    DEV: true,
    PROD: false,
    SSR: false,
    ...values,
  };
}

describe("data-mode safety", () => {
  it("defaults development to live unless mock is explicit", () => {
    expect(resolveDataMode(env({}))).toBe("live");
    expect(resolveDataMode(env({ VITE_DATA_MODE: "mock" }))).toBe("mock");
  });

  it("forces production builds to live", () => {
    expect(resolveDataMode(env({ PROD: true, DEV: false, VITE_DATA_MODE: "mock" }))).toBe("live");
  });
});
