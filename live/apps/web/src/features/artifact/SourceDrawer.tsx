import { useEffect, useRef } from "react";

import { useProvenance } from "../../application/useProvenance";
import { VideoIcon } from "../../components/Icons";
import type { ProvenanceDetail } from "../../contracts";

export function SourceDrawer({ provenanceId, onClose }: { provenanceId: string | null; onClose: () => void }) {
  const provenance = useProvenance(provenanceId);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!provenanceId) return;
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, provenanceId]);

  if (!provenanceId) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/30 backdrop-blur-sm" role="presentation">
      <aside aria-label="来源详情" aria-modal="true" className="h-full w-full max-w-md overflow-y-auto border-l border-line bg-paper p-6 shadow-soft" role="dialog">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.14em] text-accent uppercase">Source reference</p>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">这一步依据什么</h2>
          </div>
          <button aria-label="关闭来源" className="grid size-9 place-items-center rounded-full border border-line bg-white text-lg text-muted hover:text-ink" onClick={onClose} ref={closeButtonRef} type="button">×</button>
        </div>

        {provenance.isPending ? (
          <div className="mt-8 h-48 animate-pulse rounded-2xl bg-disabled" />
        ) : provenance.isError ? (
          <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-5">
            <p className="text-sm font-semibold text-red-900">来源暂时不可用</p>
            <p className="mt-2 text-xs leading-5 text-red-700">该内容不会被标记为已验证事实。</p>
          </div>
        ) : provenance.data ? (
          <ProvenanceContent provenance={provenance.data} />
        ) : null}
      </aside>
    </div>
  );
}

function ProvenanceContent({ provenance }: { provenance: ProvenanceDetail }) {
  const label = provenance.kind === "video" ? "视频时间点" : provenance.kind === "web" ? "网页资料" : "AI 综合依据";
  return (
    <div className="mt-7">
      <span className="rounded-full bg-accent-soft px-3 py-1.5 text-[10px] font-semibold text-accent">{label}</span>

      {provenance.kind === "video" && provenance.video && (
        <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-white">
          <div className="grid aspect-video place-items-center bg-disabled text-faint">
            {provenance.video.thumbnail_url ? <img alt="" className="size-full object-cover" src={provenance.video.thumbnail_url} /> : <VideoIcon className="size-8" />}
          </div>
          <div className="p-5">
            <h3 className="font-semibold">{provenance.video.title}</h3>
            <p className="mt-1 text-xs text-faint">{provenance.video.author ?? "作者未知"}</p>
            <p className="mt-4 text-xs font-medium text-accent">{formatRange(provenance.start_ms, provenance.end_ms)}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {provenance.video.playback_url && (
                <a className="primary-button w-fit" href={provenance.video.playback_url} rel="noreferrer" target="_blank">回看视频片段</a>
              )}
              {provenance.video.source_url ? (
                <a className="text-xs font-medium text-accent hover:underline" href={provenance.video.source_url} rel="noreferrer" target="_blank">查看原视频来源</a>
              ) : (
                <p className="text-xs text-faint">原视频链接未知 · AI 不猜测</p>
              )}
            </div>
          </div>
        </div>
      )}

      {provenance.kind === "web" && provenance.web && (
        <div className="mt-5 rounded-2xl border border-line bg-white p-5">
          <h3 className="font-semibold">{provenance.web.title}</h3>
          <p className="mt-1 text-xs text-faint">{provenance.web.publisher ?? webSourceLabel(provenance.web.url)}</p>
          <p className="mt-3 text-xs text-muted">访问于 {formatRetrievedAt(provenance.retrieved_at)}</p>
          <a className="primary-button mt-4 w-fit" href={provenance.web.url} rel="noreferrer" target="_blank">打开网页依据</a>
        </div>
      )}

      {provenance.kind === "inference" && (
        <div className="mt-5 rounded-2xl border border-line bg-white p-5">
          <p className="text-sm font-semibold">由多条证据综合，不伪造外部链接</p>
          <p className="mt-2 text-xs leading-5 text-muted">这是 AI 对已列来源的整理与排序，不代表新的外部事实。</p>
        </div>
      )}

      <div className="mt-5 rounded-2xl border border-line bg-canvas p-5">
        <p className="text-[10px] font-semibold tracking-[0.12em] text-faint uppercase">Evidence summary</p>
        <p className="mt-3 text-sm leading-6 text-ink">{provenance.evidence_summary}</p>
        <div className="mt-4 flex items-center justify-between text-xs text-muted">
          <span>证据置信度</span>
          <strong className="text-ink">{provenance.confidence === null ? "未提供" : `${Math.round(provenance.confidence * 100)}%`}</strong>
        </div>
      </div>
    </div>
  );
}

function formatRange(startMs: number | null, endMs: number | null): string {
  if (startMs === null || endMs === null) return "时间点未提供";
  return `${formatDuration(startMs)}–${formatDuration(endMs)}`;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatRetrievedAt(value: string | null): string {
  if (!value) return "时间未提供";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function webSourceLabel(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "网页来源";
  }
}
