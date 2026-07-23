/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_MODE?: "live" | "mock";
  readonly VITE_MOCK_SCENARIO?: string;
}
