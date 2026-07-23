import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { queryKeys } from "../../application/queryKeys";
import { SparklesIcon } from "../../components/Icons";
import type { LaunchScope, WorkspaceState } from "../../contracts";
import { useGateway } from "../../data/gatewayContext";

export type WorkspaceLaunchState = {
  goal: string;
  launchScope: LaunchScope;
  jobId: string;
  state: WorkspaceState;
  startedAt: number;
};

export const HOME_SCOPE: LaunchScope = { mode: "home", category_id: null, video_ids: [] };

export function VibeLauncher({
  hasVideos,
  launchScope = HOME_SCOPE,
  scopeDescription,
}: {
  hasVideos: boolean;
  launchScope?: LaunchScope;
  scopeDescription?: string;
}) {
  const gateway = useGateway();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [goal, setGoal] = useState("");
  const launchStartedAt = useRef(0);
  const trimmedGoal = goal.trim();
  const createWorkspace = useMutation({
    mutationFn: () => gateway.createWorkspace({ goal: trimmedGoal, launch_scope: launchScope }),
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.collection });
      const launchState: WorkspaceLaunchState = {
        goal: trimmedGoal,
        launchScope,
        jobId: response.job_id,
        state: response.state,
        startedAt: launchStartedAt.current,
      };
      navigate(`/workspace/${response.workspace_id}`, { state: launchState });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!trimmedGoal || createWorkspace.isPending) return;
    launchStartedAt.current = performance.now();
    createWorkspace.mutate();
  };

  return (
    <div className="launcher-shell mt-9 rounded-[22px] border border-line bg-canvas/80 p-2 shadow-innerline">
      {scopeDescription && (
        <p className="px-3 pt-2 pb-1 text-[11px] font-medium text-muted">启动范围：{scopeDescription}</p>
      )}
      <form className="launcher-form flex items-center gap-3 rounded-2xl bg-white px-4 py-3" onSubmit={submit}>
        <span className="launcher-icon grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <SparklesIcon className="size-4.5" />
        </span>
        <input
          aria-label="Vibe 输入"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint sm:text-base"
          maxLength={500}
          onChange={(event) => setGoal(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
          placeholder={hasVideos ? "说出你想用这些收藏完成什么…" : "导入收藏后，说说你想用它们完成什么…"}
          value={goal}
        />
        <button
          className="primary-button launcher-button shrink-0 px-4 py-3 disabled:cursor-not-allowed disabled:bg-disabled disabled:text-faint disabled:shadow-none"
          disabled={!trimmedGoal || createWorkspace.isPending}
          type="submit"
        >
          {createWorkspace.isPending ? "创建中" : "开始"}
        </button>
      </form>
      {createWorkspace.isError && (
        <p className="px-3 pt-2 pb-1 text-xs text-red-700" role="alert">
          创建工作区失败：{createWorkspace.error.message}
        </p>
      )}
    </div>
  );
}
