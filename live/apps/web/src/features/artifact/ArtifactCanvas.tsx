import { type FormEvent, useMemo, useState } from "react";

import { useArtifactItemCheck, useArtifactRevision } from "../../application/useArtifactActions";
import { useProvenance } from "../../application/useProvenance";
import { CheckIcon, SparklesIcon } from "../../components/Icons";
import type { ArtifactConflictDetail, ArtifactDocument, ArtifactItem } from "../../contracts";
import { SourceDrawer } from "./SourceDrawer";

const DEFAULT_REVISION = "压缩成一屏小纸条";

export function ArtifactCanvas({
  workspaceId,
  artifact,
  isCompiling,
  onRevisionStarted,
}: {
  workspaceId: string;
  artifact: ArtifactDocument;
  isCompiling: boolean;
  onRevisionStarted: (jobId: string) => void;
}) {
  const [selectedProvenanceId, setSelectedProvenanceId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState(DEFAULT_REVISION);
  const checkItem = useArtifactItemCheck(workspaceId);
  const revision = useArtifactRevision(workspaceId, onRevisionStarted);
  const sections = useMemo(() => [...artifact.sections].sort((left, right) => left.order - right.order), [artifact.sections]);
  const items = sections.flatMap((section) => section.items);
  const checkedCount = items.filter((item) => item.checked).length;
  const nextItem = items.find((item) => !item.checked);

  const submitRevision = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = instruction.trim();
    if (!trimmed || revision.isPending || isCompiling) return;
    revision.mutate({ artifactId: artifact.id, instruction: trimmed });
  };

  return (
    <>
      <section className="mt-6 overflow-hidden rounded-[28px] border border-line bg-paper shadow-soft" id="artifact-canvas">
        <header className="border-b border-line bg-white/55 p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-accent">
              <SparklesIcon className="size-4" />
              Artifact Canvas
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="rounded-full bg-sage-soft px-2.5 py-1.5 font-medium text-sage-dark">来源可核查</span>
              <span className="rounded-full border border-line bg-white px-2.5 py-1.5 text-muted">v{artifact.version}</span>
            </div>
          </div>
          <h2 className="mt-5 max-w-3xl text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">{artifact.title}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">{artifact.purpose}</p>
          <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-line bg-canvas p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold tracking-[0.12em] text-faint uppercase">下一步动作</p>
              <p className="mt-1 text-sm font-medium">
                {nextItem ? nextItem.text : items.length > 0 ? "全部步骤已完成，可以收起任务卡" : "暂无收藏证据支持可执行步骤"}
              </p>
            </div>
            <span className="shrink-0 text-xs font-semibold tabular-nums text-accent">
              {items.length > 0 ? `${checkedCount}/${items.length} 已完成` : "0 项可执行"}
            </span>
          </div>
        </header>

        {artifact.compact_variant && (
          <section className="m-5 rounded-3xl bg-ink p-5 text-white sm:m-8 sm:p-7">
            <p className="text-[10px] tracking-[0.14em] text-white/45 uppercase">Compact variant</p>
            <h3 className="mt-2 text-xl font-semibold">{artifact.compact_variant.title}</h3>
            <ol className="mt-5 space-y-3">
              {artifact.compact_variant.lines.map((line, index) => (
                <li className="flex gap-3 text-sm leading-6" key={`${index}-${line}`}>
                  <span className="text-white/35">{String(index + 1).padStart(2, "0")}</span>
                  <span>{line}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <div className="p-5 sm:p-8">
          <div className="relative space-y-5 before:absolute before:top-5 before:bottom-5 before:left-5 before:w-px before:bg-line sm:before:left-6">
            {sections.map((section, index) => (
              <section className="relative pl-12 sm:pl-16" key={section.id}>
                <span className="absolute top-0 left-0 grid size-10 place-items-center rounded-full border border-line bg-paper text-xs font-semibold text-accent sm:size-12">{index + 1}</span>
                <h3 className="pt-2 text-xl font-semibold tracking-[-0.03em]">{section.title}</h3>
                <div className="mt-4 space-y-3">
                  {section.items.length === 0 && (
                    <p className="rounded-2xl border border-dashed border-line bg-canvas px-4 py-3 text-xs leading-5 text-muted">
                      暂无收藏证据直接支持此阶段动作，因此不补写常识步骤。
                    </p>
                  )}
                  {section.items.map((item) => (
                    <ArtifactChecklistItem
                      artifactId={artifact.id}
                      item={item}
                      key={item.id}
                      onCheck={(checked) => checkItem.mutate({ artifactId: artifact.id, itemId: item.id, checked })}
                      onSource={setSelectedProvenanceId}
                      pending={checkItem.isPending && checkItem.variables?.itemId === item.id}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>

          {(artifact.conflict_details.length > 0 || artifact.conflicts.length > 0 || artifact.uncertainties.length > 0) && (
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              {artifact.conflict_details.length > 0 ? (
                <ConflictEvidenceCard entries={artifact.conflict_details} onSource={setSelectedProvenanceId} />
              ) : (
                <InfoCard title="冲突摘要 · 逐观点来源待补" entries={artifact.conflicts} />
              )}
              <InfoCard title="到场复核" entries={artifact.uncertainties} />
            </div>
          )}

          {checkItem.isError && <p className="mt-3 text-xs text-red-700">勾选同步失败，已恢复原状态：{checkItem.error.message}</p>}

          <form className="mt-7 rounded-2xl border border-line bg-canvas p-4 sm:p-5" onSubmit={submitRevision}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="min-w-0 flex-1">
                <span className="text-[10px] font-semibold tracking-[0.12em] text-faint uppercase">继续修改同一成果</span>
                <input aria-label="修改任务卡" className="mt-2 w-full rounded-xl border border-line bg-white px-4 py-3 text-sm outline-none focus:border-accent/50" maxLength={300} onChange={(event) => setInstruction(event.target.value)} value={instruction} />
              </label>
              <button className="primary-button disabled:cursor-not-allowed disabled:bg-disabled disabled:text-faint disabled:shadow-none" disabled={!instruction.trim() || revision.isPending || isCompiling} type="submit">
                {revision.isPending || isCompiling ? "正在更新" : "生成一屏版"}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-faint">不会新建成果；成功后保持 Artifact ID，版本递增并保留来源。</p>
            {revision.isError && <p className="mt-2 text-xs text-red-700">修改失败，原任务卡仍已保留：{revision.error.message}</p>}
          </form>
        </div>
      </section>

      <SourceDrawer provenanceId={selectedProvenanceId} onClose={() => setSelectedProvenanceId(null)} />
    </>
  );
}

function ArtifactChecklistItem({
  artifactId,
  item,
  pending,
  onCheck,
  onSource,
}: {
  artifactId: string;
  item: ArtifactItem;
  pending: boolean;
  onCheck: (checked: boolean) => void;
  onSource: (id: string) => void;
}) {
  return (
    <article className={`rounded-2xl border p-4 transition-colors ${item.checked ? "border-sage/30 bg-sage-soft/55" : "border-line bg-white"}`} data-artifact-id={artifactId}>
      <div className="flex items-start gap-3">
        <label className="mt-0.5 grid size-6 shrink-0 cursor-pointer place-items-center">
          <input aria-label={`完成：${item.text}`} checked={item.checked} className="peer sr-only" disabled={pending} onChange={(event) => onCheck(event.target.checked)} type="checkbox" />
          <span className="grid size-5 place-items-center rounded-md border border-line-strong bg-white text-transparent peer-checked:border-sage peer-checked:bg-sage peer-checked:text-white">
            <CheckIcon className="size-3.5" />
          </span>
        </label>
        <div className="min-w-0 flex-1">
          <h4 className={`text-sm font-semibold leading-5 ${item.checked ? "text-sage-dark line-through decoration-sage/40" : "text-ink"}`}>{item.text}</h4>
          {item.detail && <p className="mt-1.5 text-xs leading-5 text-muted">{item.detail}</p>}
          {item.adjustment_rule && <p className="mt-2 rounded-lg bg-canvas px-3 py-2 text-[11px] leading-5 text-muted"><strong className="text-ink">现场调整：</strong>{item.adjustment_rule}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {item.provenance_ids.map((id) => <ProvenanceBadge id={id} key={id} onOpen={() => onSource(id)} />)}
          </div>
        </div>
      </div>
    </article>
  );
}

function ProvenanceBadge({ id, onOpen }: { id: string; onOpen: () => void }) {
  const provenance = useProvenance(id);
  if (provenance.isError) {
    return <span className="rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-medium text-red-700">来源不可用</span>;
  }
  const label = provenance.data?.kind === "video" ? "Video" : provenance.data?.kind === "web" ? "Web" : provenance.data?.kind === "inference" ? "Inference" : "来源读取中";
  return (
    <button
      aria-label={`查看来源：${label}`}
      className="rounded-full border border-line bg-paper px-2.5 py-1 text-[10px] font-medium text-muted hover:border-accent/30 hover:text-accent disabled:cursor-wait"
      disabled={!provenance.data}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpen();
      }}
      type="button"
    >
      {label}
    </button>
  );
}

function ConflictEvidenceCard({ entries, onSource }: { entries: ArtifactConflictDetail[]; onSource: (id: string) => void }) {
  return (
    <section aria-label="冲突与各自依据" className="rounded-2xl border border-amber/25 bg-amber-50 p-4">
      <h3 className="text-xs font-semibold text-amber-dark">冲突与各自依据</h3>
      <div className="mt-3 space-y-4">
        {entries.map((entry, entryIndex) => (
          <article className="rounded-xl border border-amber/20 bg-white/70 p-3" key={`${entry.topic}-${entryIndex}`}>
            <h4 className="text-xs font-semibold text-ink">{entry.topic}</h4>
            <ol className="mt-3 space-y-3">
              {entry.viewpoints.map((viewpoint, viewpointIndex) => (
                <li className="text-xs leading-5 text-muted" key={`${viewpoint.statement}-${viewpointIndex}`}>
                  <p><strong className="text-ink">观点 {viewpointIndex + 1}：</strong>{viewpoint.statement}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {viewpoint.provenance_ids.map((id) => <ProvenanceBadge id={id} key={id} onOpen={() => onSource(id)} />)}
                  </div>
                </li>
              ))}
            </ol>
            {entry.resolution && <p className="mt-3 border-t border-amber/20 pt-3 text-[11px] leading-5 text-muted"><strong className="text-ink">处理原则：</strong>{entry.resolution}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}

function InfoCard({ title, entries }: { title: string; entries: string[] }) {
  if (entries.length === 0) return null;
  return (
    <article className="rounded-2xl border border-amber/25 bg-amber-50 p-4">
      <h3 className="text-xs font-semibold text-amber-dark">{title}</h3>
      <ul className="mt-2 space-y-1.5 text-xs leading-5 text-muted">
        {entries.map((entry) => <li key={entry}>· {entry}</li>)}
      </ul>
    </article>
  );
}
