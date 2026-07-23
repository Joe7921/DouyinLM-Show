import { describe, expect, it } from "vitest";

import { happyPathScenario } from "../data/fixtures";
import { candidateVideoIds, categoryLaunchScope, outOfScopeDecisionIds } from "./workspace";

describe("workspace range invariants", () => {
  it("keeps every happy-path decision inside the inherited home scope", () => {
    const candidates = candidateVideoIds(
      happyPathScenario.workspaceTemplate.launch_scope,
      happyPathScenario.collection.videos.map((video) => video.id),
    );

    expect(candidates).toHaveLength(4);
    expect(outOfScopeDecisionIds(happyPathScenario.workspaceTemplate, candidates)).toEqual([]);
  });

  it("reports a decision that silently expands beyond selected videos", () => {
    const workspace = structuredClone(happyPathScenario.workspaceTemplate);
    workspace.launch_scope = {
      mode: "selected",
      category_id: null,
      video_ids: ["mock-video-light-001", "mock-video-review-003"],
    };
    const candidates = candidateVideoIds(workspace.launch_scope, []);

    expect(outOfScopeDecisionIds(workspace, candidates)).toContain("mock-video-composition-002");
  });

  it("maps category selection to major, subcategory, single, and selected scopes", () => {
    expect(categoryLaunchScope("major-1", 1, [])).toEqual({
      mode: "major",
      category_id: "major-1",
      video_ids: [],
    });
    expect(categoryLaunchScope("subcategory-1", 2, [])).toEqual({
      mode: "subcategory",
      category_id: "subcategory-1",
      video_ids: [],
    });
    expect(categoryLaunchScope("major-1", 1, ["video-1"])).toEqual({
      mode: "single",
      category_id: null,
      video_ids: ["video-1"],
    });
    expect(categoryLaunchScope("major-1", 1, ["video-1", "video-2", "video-1"])).toEqual({
      mode: "selected",
      category_id: null,
      video_ids: ["video-1", "video-2"],
    });
  });
});
