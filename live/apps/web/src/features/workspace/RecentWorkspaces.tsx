import { Link } from "react-router-dom";

import { ArrowIcon } from "../../components/Icons";
import type { WorkspaceCard, WorkspaceState } from "../../contracts";

const STATE_LABELS: Record<WorkspaceState, string> = {
  forming: "正在理解",
  clarifying: "等待确认",
  compiling: "正在生成",
  ready: "已完成",
  failed: "需要处理",
};

export function RecentWorkspaces({ workspaces }: { workspaces: WorkspaceCard[] }) {
  if (workspaces.length === 0) return null;

  return (
    <section className="mt-10">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow w-fit">最近工作区</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">离开后，成果仍然在这里</h2>
        </div>
        <span className="hidden text-xs text-faint sm:block">按最近更新排序</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {workspaces.map((workspace) => (
          <Link
            className="group rounded-2xl border border-line bg-paper p-5 shadow-whisper transition-transform hover:-translate-y-0.5"
            key={workspace.id}
            to={`/workspace/${workspace.id}`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-medium text-accent">{STATE_LABELS[workspace.state]}</span>
              <ArrowIcon className="size-4 text-faint transition-transform group-hover:translate-x-0.5" />
            </div>
            <h3 className="mt-3 line-clamp-2 text-base font-semibold tracking-[-0.02em]">{workspace.title}</h3>
            <p className="mt-2 text-[11px] text-faint">{formatUpdatedAt(workspace.updated_at)}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "最近更新";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}
