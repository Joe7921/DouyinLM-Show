import { Link, useLocation, useParams } from "react-router-dom";
import { useRef, useState } from "react";

import { workspaceDisplayProgress } from "../../application/jobProgress";
import { useCategory, useCollection } from "../../application/useCollection";
import { useJobProgress } from "../../application/useJobProgress";
import { useScopeExpansion } from "../../application/useScopeExpansion";
import { useRetryWorkspaceJob, useWorkspace } from "../../application/useWorkspace";
import { ArrowIcon, BackIcon, CheckIcon, RefreshIcon, SparklesIcon } from "../../components/Icons";
import type { JobCard, ScopeExpansionOption, WorkspaceState } from "../../contracts";
import { candidateVideoIds, launchScopeLabel, outOfScopeDecisionIds } from "../../domain/workspace";
import type { WorkspaceLaunchState } from "../work-launcher/VibeLauncher";
import { ArtifactCanvas } from "../artifact/ArtifactCanvas";
import { ClarificationCard } from "./ClarificationCard";
import { DecisionPanels, RunTrace, SystemEventNotice } from "./WorkspaceEvidence";

const STATE_COPY: Record<WorkspaceState, { label: string; detail: string }> = {
  forming: { label: "正在理解目标", detail: "继承收藏范围并识别真正相关的视频" },
  clarifying: { label: "等待一个关键确认", detail: "你的回答会直接改变最终成果" },
  compiling: { label: "正在编译成果", detail: "把来源重构为现场可执行的任务卡" },
  ready: { label: "工作区已就绪", detail: "内容筛选和成果结构已经完成" },
  failed: { label: "本次生成未完成", detail: "失败原因会保留，不会展示伪成果" },
};

export function WorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const launchState = location.state as WorkspaceLaunchState | null;
  const skeletonLatencyMs = useRef(
    launchState?.startedAt ? Math.max(0, Math.round(performance.now() - launchState.startedAt)) : null,
  );
  const [continuation, setContinuation] = useState<{ jobId: string; state: WorkspaceState } | null>(null);
  const workspace = useWorkspace(id);
  const retryJob = useRetryWorkspaceJob(id);
  const expandScope = useScopeExpansion(id);
  const collection = useCollection();
  const current = workspace.data;
  const settledState = current?.state === "ready" || current?.state === "failed";
  const state = settledState
    ? current.state
    : (continuation?.state ?? current?.state ?? launchState?.state ?? "forming");
  const jobId = current?.active_job?.id ?? continuation?.jobId ?? launchState?.jobId;
  const isRunning = state === "forming" || state === "compiling";
  const progress = useJobProgress({
    jobId,
    workspaceId: id,
    enabled: isRunning,
    afterSequence: current?.active_job?.latest_event?.sequence ?? 0,
  });
  const goal = current?.original_goal ?? launchState?.goal;
  const latestEvent = progress.event ?? current?.active_job?.latest_event;
  const progressValue = workspaceDisplayProgress(state, latestEvent?.progress);
  const stateCopy = STATE_COPY[state];
  const progressMessage = state === "clarifying" ? stateCopy.detail : (latestEvent?.message ?? stateCopy.detail);
  const scope = current?.launch_scope ?? launchState?.launchScope;
  const categoryId = scope?.mode === "major" || scope?.mode === "subcategory"
    ? (scope.category_id ?? undefined)
    : undefined;
  const category = useCategory(categoryId);
  const videos = collection.data?.videos ?? [];
  const scopedVideos = categoryId ? (category.data?.videos ?? []) : videos;
  const candidates = scope ? candidateVideoIds(scope, scopedVideos.map((video) => video.id)) : [];
  const outOfScopeIds = current ? outOfScopeDecisionIds(current, candidates) : [];
  const question = state === "clarifying"
    ? [...(current?.messages ?? [])].reverse().find((message) => message.role === "assistant")?.content
    : undefined;
  const scopeExpansionOptions = current?.scope_expansion_options ?? [];

  if (!id) return <WorkspaceMissing />;
  if (workspace.isError && !launchState) {
    return (
      <div className="mx-auto max-w-xl px-6 py-20 text-center">
        <p className="eyebrow mx-auto w-fit">Workspace</p>
        <h1 className="mt-5 text-3xl font-semibold tracking-[-0.04em]">无法恢复这个工作区</h1>
        <p className="mt-3 text-sm leading-6 text-muted">{workspace.error.message}</p>
        <button className="primary-button mt-7" onClick={() => void workspace.refetch()} type="button">
          重新读取
        </button>
      </div>
    );
  }

  return (
    <div
      className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12"
      data-skeleton-latency-ms={skeletonLatencyMs.current ?? undefined}
    >
      <div className="mb-7 flex items-center justify-between gap-4">
        <Link className="inline-flex items-center gap-2 text-xs font-medium text-muted hover:text-ink" to="/">
          <BackIcon className="size-4" />
          返回收藏夹
        </Link>
        <span className="rounded-full border border-line bg-white/70 px-3 py-1.5 text-[10px] font-medium tracking-[0.08em] text-muted uppercase">
          {scope ? launchScopeLabel(scope) : "正在恢复范围"}
        </span>
      </div>

      <section className="animate-rise overflow-hidden rounded-[28px] border border-line bg-paper shadow-soft">
        <div className="grid lg:grid-cols-[1fr_300px]">
          <div className="p-6 sm:p-9">
            <div className="flex items-center gap-2 text-xs font-medium text-accent">
              <SparklesIcon className="size-4" />
              自动工作区
            </div>
            <p className="mt-6 text-xs tracking-[0.12em] text-faint uppercase">你的原始目标</p>
            {goal ? (
              <h1 className="mt-3 max-w-3xl text-2xl leading-snug font-semibold tracking-[-0.035em] sm:text-4xl">{goal}</h1>
            ) : (
              <div className="mt-4 h-20 animate-pulse rounded-2xl bg-disabled" aria-label="正在恢复用户目标" />
            )}
            <div className="mt-8 rounded-2xl border border-line bg-canvas/70 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold">{stateCopy.label}</p>
                  <p className="mt-1 text-xs leading-5 text-muted">{progressMessage}</p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-accent">{progressValue}%</span>
              </div>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-disabled">
                <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${progressValue}%` }} />
              </div>
              {progress.transport === "polling" && (
                <p className="mt-3 text-xs text-amber-dark">实时事件连接中断，已自动切换轮询恢复。</p>
              )}
              {progress.error && <p className="mt-3 text-xs text-red-700">进度连接中断：{progress.error.message}</p>}
            </div>
          </div>

          <aside className="border-t border-line bg-ink p-6 text-white lg:border-t-0 lg:border-l">
            <p className="text-[10px] tracking-[0.14em] text-white/45 uppercase">Execution scope</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Metric label="候选" value={candidates.length} />
              <Metric label="采用" value={current?.adopted_videos.length ?? 0} />
            </div>
            <div className="mt-7 space-y-3">
              <ScopeStep label="继承收藏范围" complete />
              <ScopeStep label="选择相关来源" complete={progressValue >= 35} />
              <ScopeStep label="编译可执行成果" complete={progressValue >= 75} />
              <ScopeStep label="校验关键来源" complete={progressValue >= 100} />
            </div>
          </aside>
        </div>
      </section>

      {current && <SystemEventNotice messages={current.messages} />}

      {state === "failed" && current && (
        <WorkspaceFailureCard
          job={current.active_job}
          isRetrying={retryJob.isPending}
          onRetry={(jobId) => retryJob.mutate(jobId)}
          retryError={retryJob.error}
          showRetry={scopeExpansionOptions.length === 0}
        />
      )}

      {state === "failed" && scopeExpansionOptions.length > 0 && (
        <ScopeExpansionCard
          error={expandScope.error}
          isPending={expandScope.isPending}
          onExpand={(option) => expandScope.mutate(
            { target: option.target },
            { onSuccess: (response) => setContinuation({ jobId: response.job_id, state: response.state }) },
          )}
          options={scopeExpansionOptions}
        />
      )}

      {current?.artifact && id && (
        <ArtifactCanvas
          artifact={current.artifact}
          isCompiling={state === "compiling"}
          onRevisionStarted={(jobId) => setContinuation({ jobId, state: "compiling" })}
          workspaceId={id}
        />
      )}

      {state === "clarifying" && question && id && (
        <ClarificationCard
          workspaceId={id}
          question={question}
          onStarted={(response) => setContinuation({ jobId: response.job_id, state: response.state })}
        />
      )}

      {current && (
        <DecisionPanels
          adopted={current.adopted_videos}
          excluded={current.excluded_videos}
          videos={videos}
          outOfScopeIds={outOfScopeIds}
        />
      )}

      <RunTrace messages={current?.messages ?? []} jobEvents={progress.events} transport={progress.transport} />

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <WorkspacePlaceholder
          eyebrow="范围"
          title={scope ? `继承${launchScopeLabel(scope)}，候选 ${candidates.length} 条` : "正在恢复候选范围"}
          detail="范围不会被静默扩大；采用与排除都必须来自当前候选集。"
        />
        <WorkspacePlaceholder
          eyebrow="产出"
          title={state === "ready" ? (current?.artifact?.title ?? "成果已经生成") : "生成完成后回到同一工作区"}
          detail={current?.artifact ? `同一 Artifact · v${current.artifact.version} · 来源关系已保留` : "可以离开当前页面，后台任务不会占用你的操作。"}
        />
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <span className="block text-[10px] text-white/40">{label}</span>
      <strong className="mt-1 block text-xl font-semibold tabular-nums">{value}</strong>
    </div>
  );
}

function ScopeStep({ label, complete }: { label: string; complete: boolean }) {
  return (
    <div className={`flex items-center gap-3 rounded-xl border p-3 text-xs ${complete ? "border-white/20 bg-white/10 text-white" : "border-white/10 text-white/45"}`}>
      <span className={`grid size-6 place-items-center rounded-full ${complete ? "bg-white text-ink" : "border border-white/15"}`}>
        {complete ? <CheckIcon className="size-3.5" /> : <span className="size-1.5 rounded-full bg-white/25" />}
      </span>
      {label}
    </div>
  );
}

function WorkspacePlaceholder({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return (
    <article className="rounded-2xl border border-line bg-paper p-5 shadow-whisper">
      <p className="text-[10px] font-medium tracking-[0.12em] text-faint uppercase">{eyebrow}</p>
      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-[-0.02em]">{title}</h2>
          <p className="mt-1.5 text-xs leading-5 text-muted">{detail}</p>
        </div>
        <ArrowIcon className="mt-0.5 size-4 shrink-0 text-faint" />
      </div>
    </article>
  );
}

function WorkspaceFailureCard({
  job,
  isRetrying,
  onRetry,
  retryError,
  showRetry,
}: {
  job: JobCard | null;
  isRetrying: boolean;
  onRetry: (jobId: string) => void;
  retryError: Error | null;
  showRetry: boolean;
}) {
  const blocked = job?.status === "blocked";
  const detail = job?.last_error ?? job?.latest_event?.message ?? "失败原因已保留，本次没有发布成果。";

  return (
    <section
      className="mt-6 rounded-3xl border border-amber/30 bg-amber-50 p-5 shadow-whisper sm:p-6"
      data-testid="workspace-failure"
    >
      <p className="text-[10px] font-semibold tracking-[0.12em] text-amber-dark uppercase">
        {blocked ? "配置阻塞" : "生成失败"}
      </p>
      <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">
        {blocked ? "完成配置后再继续" : "原目标与工作区已保留"}
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-amber-dark">{detail}</p>
      <p className="mt-2 text-xs leading-5 text-muted">
        {blocked
          ? "系统不会循环重试，也不会用 Mock 或旧成果替代本次结果。"
          : showRetry
            ? "重试会继续使用当前工作区，不会创建第二个 Workspace。"
            : "当前范围不会自动改变；请在下方选择是否扩大，选择后仍继续使用同一 Workspace。"}
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {!blocked && job && showRetry && (
          <button
            className="primary-button disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isRetrying}
            onClick={() => onRetry(job.id)}
            type="button"
          >
            <RefreshIcon className="size-4" />
            {isRetrying ? "正在恢复…" : "在原工作区重试"}
          </button>
        )}
        {blocked && (
          <Link className="rounded-xl border border-amber/30 bg-white px-4 py-3 text-xs font-semibold text-ink hover:border-ink/30" to="/ops/diagnostics">
            查看配置状态
          </Link>
        )}
        <Link className="text-xs font-medium text-muted hover:text-ink" to="/">
          返回收藏夹
        </Link>
      </div>
      {retryError && <p className="mt-4 text-xs text-red-700">恢复失败：{retryError.message}</p>}
    </section>
  );
}

function ScopeExpansionCard({
  options,
  isPending,
  onExpand,
  error,
}: {
  options: ScopeExpansionOption[];
  isPending: boolean;
  onExpand: (option: ScopeExpansionOption) => void;
  error: Error | null;
}) {
  return (
    <section className="mt-6 rounded-3xl border border-accent/25 bg-accent-soft/45 p-5 shadow-whisper sm:p-6" data-testid="scope-expansion">
      <p className="text-[10px] font-semibold tracking-[0.12em] text-accent uppercase">范围证据不足</p>
      <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">由你决定是否扩大收藏范围</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
        系统没有静默引用范围外视频，也没有强行生成任务卡。选择后会在同一工作区重新筛选，并记录这次范围变化。
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        {options.map((option) => (
          <button
            className="primary-button disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isPending}
            key={option.target}
            onClick={() => onExpand(option)}
            type="button"
          >
            {isPending ? "正在扩大…" : option.label}
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px]">{option.candidate_count} 条</span>
          </button>
        ))}
      </div>
      <p className="mt-4 text-xs leading-5 text-muted">联网研究当前按战时降级关闭；页面不会把不可用工具伪装成选项。</p>
      {error && <p className="mt-3 text-xs text-red-700">扩大范围失败：{error.message}</p>}
    </section>
  );
}

function WorkspaceMissing() {
  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <p className="eyebrow mx-auto w-fit">Workspace</p>
      <h1 className="mt-5 text-3xl font-semibold tracking-[-0.04em]">工作区地址不完整</h1>
      <Link className="primary-button mx-auto mt-7 w-fit" to="/">返回收藏夹</Link>
    </div>
  );
}
