import { describe, expect, it } from "vitest";

import { happyPathScenario } from "../data/fixtures";
import { artifactCompletion, setArtifactItemChecked } from "./artifact";

describe("artifact checklist state", () => {
  it("updates checklist state without mutating content version or the previous snapshot", () => {
    const before = structuredClone(happyPathScenario.workspaceTemplate);
    const itemId = before.artifact?.sections[0]?.items[0]?.id;
    if (!itemId || !before.artifact) throw new Error("expected artifact item");

    const after = setArtifactItemChecked(before, itemId, true);

    expect(before.artifact.sections[0]?.items[0]?.checked).toBe(false);
    expect(after.artifact?.sections[0]?.items[0]?.checked).toBe(true);
    expect(after.artifact?.version).toBe(before.artifact.version);
    expect(artifactCompletion(after)).toEqual({ checked: 1, total: 5 });
  });
});
