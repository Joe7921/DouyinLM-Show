import type { LaunchScope, WorkspaceDetail } from "../contracts";

export function candidateVideoIds(scope: LaunchScope, allVideoIds: string[]): string[] {
  if (scope.mode === "home" || scope.mode === "major" || scope.mode === "subcategory") {
    return [...new Set(allVideoIds)];
  }
  if (scope.mode === "selected" || scope.mode === "single") return [...scope.video_ids];
  return [];
}

export function categoryLaunchScope(
  categoryId: string,
  level: 1 | 2,
  selectedVideoIds: string[],
): LaunchScope {
  const selected = [...new Set(selectedVideoIds)];
  if (selected.length === 0) {
    return {
      mode: level === 1 ? "major" : "subcategory",
      category_id: categoryId,
      video_ids: [],
    };
  }
  if (selected.length === 1) {
    return { mode: "single", category_id: null, video_ids: selected };
  }
  return { mode: "selected", category_id: null, video_ids: selected };
}

export function outOfScopeDecisionIds(workspace: WorkspaceDetail, candidates: string[]): string[] {
  const candidateSet = new Set(candidates);
  return [
    ...workspace.adopted_videos.map((entry) => entry.video_id),
    ...workspace.excluded_videos.map((entry) => entry.video_id),
  ].filter((id) => !candidateSet.has(id));
}

export function launchScopeLabel(scope: LaunchScope): string {
  const labels: Record<LaunchScope["mode"], string> = {
    home: "全部收藏",
    major: "AI 大类",
    subcategory: "AI 小类",
    selected: "已选视频",
    single: "单条视频",
  };
  return labels[scope.mode];
}
