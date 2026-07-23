import type { AdoptedVideo, ExcludedVideo, JobEventCard, VideoCard, WorkspaceMessage } from "../../contracts";

type Decision = AdoptedVideo | ExcludedVideo;

export function DecisionPanels({
  adopted,
  excluded,
  videos,
  outOfScopeIds,
}: {
  adopted: AdoptedVideo[];
  excluded: ExcludedVideo[];
  videos: VideoCard[];
  outOfScopeIds: string[];
}) {
  if (adopted.length === 0 && excluded.length === 0) return null;
  const titles = new Map(videos.map((video) => [video.id, video.title]));

  return (
    <section className="mt-6 grid gap-4 lg:grid-cols-2">
      <DecisionGroup title={`已采用 ${adopted.length} 条`} description="这些内容能直接改变最终行动步骤" decisions={adopted} titles={titles} tone="adopted" />
      <DecisionGroup title={`已排除 ${excluded.length} 条`} description="保留在收藏中，但不进入本次成果" decisions={excluded} titles={titles} tone="excluded" />
      {outOfScopeIds.length > 0 && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 lg:col-span-2" role="alert">
          范围校验失败：{outOfScopeIds.length} 条决策不属于候选范围，已停止将其视为可信结果。
        </p>
      )}
    </section>
  );
}

function DecisionGroup({
  title,
  description,
  decisions,
  titles,
  tone,
}: {
  title: string;
  description: string;
  decisions: Decision[];
  titles: Map<string, string>;
  tone: "adopted" | "excluded";
}) {
  return (
    <details className="group rounded-2xl border border-line bg-paper p-5 shadow-whisper" open={tone === "adopted"}>
      <summary className="cursor-pointer list-none">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={`text-sm font-semibold ${tone === "adopted" ? "text-sage-dark" : "text-muted"}`}>{title}</p>
            <p className="mt-1 text-xs text-faint">{description}</p>
          </div>
          <span className="text-lg leading-none text-faint transition-transform group-open:rotate-45">+</span>
        </div>
      </summary>
      <div className="mt-4 space-y-3 border-t border-line pt-4">
        {decisions.map((decision) => (
          <article key={decision.video_id}>
            <h3 className="text-sm font-medium">{titles.get(decision.video_id) ?? decision.video_id}</h3>
            <p className="mt-1 text-xs leading-5 text-muted">{decision.reason}</p>
          </article>
        ))}
      </div>
    </details>
  );
}

export function SystemEventNotice({ messages }: { messages: WorkspaceMessage[] }) {
  const latest = [...messages].reverse().find((message) => message.role === "system_event");
  if (!latest) return null;
  return (
    <div className="mt-5 rounded-2xl border border-line bg-white/65 px-4 py-3 text-xs leading-5 text-muted">
      <span className="mr-2 font-semibold text-ink">范围与工具决策</span>
      {latest.content}
    </div>
  );
}

export function RunTrace({
  messages,
  jobEvents,
  transport,
}: {
  messages: WorkspaceMessage[];
  jobEvents: JobEventCard[];
  transport: "sse" | "polling";
}) {
  const systemEvents = messages
    .filter((message) => message.role === "system_event")
    .map((message) => ({ id: message.id, content: message.content, createdAt: message.created_at }));
  const progressEvents = jobEvents.map((event) => ({
    id: `job-${event.sequence}`,
    content: event.message,
    createdAt: event.created_at,
  }));
  const entries = [...systemEvents, ...progressEvents].filter(
    (entry, index, all) => all.findIndex((candidate) => candidate.content === entry.content) === index,
  );
  const didNotUseWeb = entries.some((entry) => /无需联网|未联网/.test(entry.content));

  return (
    <details className="mt-6 rounded-2xl border border-line bg-paper p-5 shadow-whisper">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">可验证运行记录</p>
            <p className="mt-1 text-xs text-faint">只展示范围、工具和任务事件，不展示模型私有推理</p>
          </div>
          <div className="flex items-center gap-2">
            {didNotUseWeb && <span className="rounded-full bg-sage-soft px-2.5 py-1 text-[10px] font-medium text-sage-dark">未联网</span>}
            <span className="rounded-full bg-canvas px-2.5 py-1 text-[10px] text-muted">{transport === "polling" ? "轮询恢复中" : "实时事件"}</span>
          </div>
        </div>
      </summary>
      <div className="mt-4 space-y-3 border-t border-line pt-4">
        {entries.length === 0 ? (
          <p className="text-xs text-faint">等待第一条可验证任务事件。</p>
        ) : entries.map((entry) => (
          <div className="flex gap-3" key={entry.id}>
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-sage" />
            <div>
              <p className="text-xs leading-5 text-muted">{entry.content}</p>
              <p className="mt-0.5 text-[10px] text-faint">{formatTime(entry.createdAt)}</p>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "任务事件";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}
