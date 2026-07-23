import type { WorkspaceDetail } from "../contracts";

export function setArtifactItemChecked(
  workspace: WorkspaceDetail,
  itemId: string,
  checked: boolean,
): WorkspaceDetail {
  const next = structuredClone(workspace);
  const item = next.artifact?.sections
    .flatMap((section) => section.items)
    .find((candidate) => candidate.id === itemId);
  if (!item) return workspace;
  item.checked = checked;
  return next;
}

export function artifactCompletion(workspace: WorkspaceDetail): { checked: number; total: number } {
  const items = workspace.artifact?.sections.flatMap((section) => section.items) ?? [];
  return {
    checked: items.filter((item) => item.checked).length,
    total: items.length,
  };
}
