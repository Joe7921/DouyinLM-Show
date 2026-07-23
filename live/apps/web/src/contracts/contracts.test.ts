import { describe, expect, it } from "vitest";

import realWorkspaceHappy from "../../../../skills/collection-artifact-compiler/examples/real-workspace-happy.json";
import {
  getMockScenario,
  happyPathScenario,
  REQUIRED_MOCK_SCENARIOS,
} from "../data/fixtures";
import {
  ContractParseError,
  parseCategoryDetail,
  parseCollectionResponse,
  parseJobEventCard,
  parseProvidersHealth,
  parseProvenanceDetail,
  parseReadyHealth,
  parseWorkspaceDetail,
} from "./parsers";

describe("upper-layer runtime contracts", () => {
  it("accepts the real Ark H1 Workspace through the frozen frontend parser", () => {
    const workspace = parseWorkspaceDetail(realWorkspaceHappy);
    const items = workspace.artifact?.sections.flatMap((section) => section.items) ?? [];

    expect(workspace.state).toBe("ready");
    expect(workspace.active_job?.status).toBe("completed");
    expect(workspace.adopted_videos).toHaveLength(4);
    expect(workspace.excluded_videos).toHaveLength(2);
    expect(workspace.artifact?.version).toBe(1);
    expect(items).toHaveLength(9);
    expect(items.every((item) => item.provenance_ids.length > 0)).toBe(true);
  });

  it("accepts all required fixtures through the same runtime parsers", () => {
    for (const key of REQUIRED_MOCK_SCENARIOS) {
      const scenario = getMockScenario(key);
      expect(parseCollectionResponse(scenario.collection)).toBeDefined();
      expect(parseReadyHealth(scenario.ready)).toBeDefined();
      expect(parseProvidersHealth(scenario.providers)).toBeDefined();
      expect(parseWorkspaceDetail(scenario.workspaceTemplate)).toBeDefined();
      if (scenario.recoveryWorkspaceTemplate) {
        expect(parseWorkspaceDetail(scenario.recoveryWorkspaceTemplate).artifact).not.toBeNull();
      }
      for (const category of Object.values(scenario.categories)) parseCategoryDetail(category);
      for (const provenance of Object.values(scenario.provenance)) parseProvenanceDetail(provenance);
      const events = [...scenario.jobEvents, ...scenario.retryJobEvents].map((event) =>
        parseJobEventCard(event),
      );
      expect(new Set(events.map((event) => event.sequence)).size).toBe(events.length);
      expect(scenario.origin).toMatch(/handcrafted|pipeline_export/);
      if (scenario.failure) expect(scenario.workspaceTemplate.artifact).toBeNull();
    }
  });

  it("accepts the handcrafted happy-path fixture without leaking fixture metadata", () => {
    const collection = parseCollectionResponse(happyPathScenario.collection);
    const workspace = parseWorkspaceDetail(happyPathScenario.workspaceTemplate);

    expect(collection.is_demo_data).toBe(true);
    expect(collection.videos.every((video) => video.content_types.length > 0)).toBe(true);
    expect(collection).not.toHaveProperty("origin");
    expect(workspace.artifact?.sections.map((section) => section.title)).toEqual([
      "拍摄前",
      "到场后",
      "拍完后",
    ]);
    expect(workspace.artifact?.sections.flatMap((section) => section.items)).toSatisfy(
      (items: Array<{ provenance_ids: string[] }>) =>
        items.every((item) => item.provenance_ids.length > 0),
    );
    expect(workspace.artifact?.conflict_details).toHaveLength(1);
    expect(workspace.artifact?.conflict_details[0]?.viewpoints).toHaveLength(2);
    expect(workspace.artifact?.conflict_details[0]?.viewpoints.every((viewpoint) => viewpoint.provenance_ids.length > 0)).toBe(true);
  });

  it("rejects a conflict without two independently sourced viewpoints", () => {
    const invalid = structuredClone(happyPathScenario.workspaceTemplate);
    invalid.artifact!.conflict_details[0]!.viewpoints = invalid.artifact!.conflict_details[0]!.viewpoints.slice(0, 1);
    expect(() => parseWorkspaceDetail(invalid)).toThrow("conflict requires at least two sourced viewpoints");
  });

  it("rejects a conflict viewpoint without provenance", () => {
    const invalid = structuredClone(happyPathScenario.workspaceTemplate);
    invalid.artifact!.conflict_details[0]!.viewpoints[0]!.provenance_ids = [];
    expect(() => parseWorkspaceDetail(invalid)).toThrow("conflict viewpoint requires at least one provenance id");
  });

  it("accepts every registered category and provenance object", () => {
    for (const category of Object.values(happyPathScenario.categories)) {
      expect(parseCategoryDetail(category).id).toBe(category.id);
    }
    for (const provenance of Object.values(happyPathScenario.provenance)) {
      expect(parseProvenanceDetail(provenance).id).toBe(provenance.id);
    }
  });

  it("rejects unexpected response fields", () => {
    const invalid = { ...happyPathScenario.collection, hidden_mock_flag: true };
    expect(() => parseCollectionResponse(invalid)).toThrow(ContractParseError);
    expect(() => parseCollectionResponse(invalid)).toThrow("unexpected keys: hidden_mock_flag");
  });

  it("rejects missing required fields", () => {
    const invalid = structuredClone(happyPathScenario.workspaceTemplate) as Record<string, unknown>;
    delete invalid.launch_scope;
    expect(() => parseWorkspaceDetail(invalid)).toThrow("missing keys: launch_scope");
  });

  it("rejects duplicate scope-expansion targets", () => {
    const invalid = structuredClone(happyPathScenario.workspaceTemplate);
    invalid.scope_expansion_options = [
      { target: "home", label: "使用全部收藏", candidate_count: 6 },
      { target: "home", label: "再次使用全部收藏", candidate_count: 6 },
    ];
    expect(() => parseWorkspaceDetail(invalid)).toThrow("expected unique target values");
  });

  it("rejects a video card without pipeline-derived content types", () => {
    const invalid = structuredClone(happyPathScenario.collection) as unknown as {
      videos: Array<Record<string, unknown>>;
    };
    delete invalid.videos[0]?.content_types;
    expect(() => parseCollectionResponse(invalid)).toThrow("missing keys: content_types");
  });

  it("rejects invalid launch-scope semantics", () => {
    const invalid = structuredClone(happyPathScenario.workspaceTemplate);
    invalid.launch_scope = { mode: "single", category_id: null, video_ids: [] };
    expect(() => parseWorkspaceDetail(invalid)).toThrow("single scope requires exactly one video_id");
  });

  it("rejects video provenance without a visible time range", () => {
    const invalid = structuredClone(happyPathScenario.provenance["mock-prov-video-001"]);
    invalid.start_ms = null;
    expect(() => parseProvenanceDetail(invalid)).toThrow("video provenance requires video and time range only");
  });

  it("rejects a shooting task card that breaks the three-stage structure", () => {
    const invalid = structuredClone(happyPathScenario.workspaceTemplate);
    if (!invalid.artifact) throw new Error("expected artifact");
    invalid.artifact.sections[1]!.title = "自由发挥";
    expect(() => parseWorkspaceDetail(invalid)).toThrow("requires 拍摄前, 到场后, 拍完后 in order");
  });

  it("rejects a compact variant that cannot fit one screen", () => {
    const invalid = structuredClone(happyPathScenario.workspaceTemplate);
    if (!invalid.artifact) throw new Error("expected artifact");
    invalid.artifact.compact_variant = {
      title: "过长版本",
      lines: Array.from({ length: 9 }, (_, index) => `步骤 ${index + 1}`),
    };
    expect(() => parseWorkspaceDetail(invalid)).toThrow("expected 1 to 8 compact lines");
  });
});
