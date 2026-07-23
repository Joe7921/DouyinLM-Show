import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useCategory } from "../../application/useCollection";
import { BackIcon, CheckIcon, CollectionIcon, VideoIcon } from "../../components/Icons";
import type { VideoCard } from "../../contracts";
import { categoryLaunchScope, launchScopeLabel } from "../../domain/workspace";
import { VibeLauncher } from "../work-launcher/VibeLauncher";

export function CategoryPage() {
  const { id } = useParams<{ id: string }>();
  const category = useCategory(id);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const readyVideos = useMemo(
    () => (category.data?.videos ?? []).filter((video) => video.status === "ready"),
    [category.data?.videos],
  );
  const availableIds = new Set(readyVideos.map((video) => video.id));
  const selection = selectedIds.filter((videoId) => availableIds.has(videoId));

  if (!id) return <CategoryError title="类目地址不完整" detail="请返回收藏夹重新选择范围。" />;
  if (category.isPending) return <CategoryLoading />;
  if (category.isError || !category.data) {
    return (
      <CategoryError
        title="无法读取这个收藏范围"
        detail={category.error?.message ?? "类目不存在或暂时不可用。"}
        onRetry={() => void category.refetch()}
      />
    );
  }

  const launchScope = categoryLaunchScope(category.data.id, category.data.level, selection);
  const scopeDescription = selection.length > 0
    ? `${launchScopeLabel(launchScope)} · ${selection.length} 条`
    : `${launchScopeLabel(launchScope)} · ${readyVideos.length} 条`;
  const toggleVideo = (videoId: string) => {
    setSelectedIds((current) => current.includes(videoId)
      ? current.filter((item) => item !== videoId)
      : [...current, videoId]);
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <Link className="inline-flex items-center gap-2 text-xs font-medium text-muted hover:text-ink" to="/">
        <BackIcon className="size-4" />
        返回收藏夹
      </Link>

      <section className="mt-6 overflow-hidden rounded-[28px] border border-line bg-paper shadow-soft">
        <div className="grid min-w-0 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0 p-6 sm:p-9">
            <div className="flex flex-wrap items-center gap-2">
              <span className="eyebrow">{category.data.level === 1 ? "AI 大类" : "AI 小类"}</span>
              <span className="status-dot">{readyVideos.length} 条已理解内容</span>
            </div>
            <h1 className="mt-5 text-3xl font-semibold tracking-[-0.04em] sm:text-5xl">{category.data.name}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted sm:text-base">{category.data.purpose}</p>
            <VibeLauncher
              hasVideos={readyVideos.length > 0}
              launchScope={launchScope}
              scopeDescription={scopeDescription}
            />
          </div>
          <aside className="border-t border-line bg-ink p-6 text-white lg:border-t-0 lg:border-l">
            <p className="text-[10px] tracking-[0.14em] text-white/45 uppercase">Launch scope</p>
            <strong className="mt-3 block text-2xl font-semibold">{launchScopeLabel(launchScope)}</strong>
            <p className="mt-2 text-xs leading-5 text-white/60">
              {selection.length === 0
                ? "当前使用整个类目；勾选内容后会自动收窄为单条或多选范围。"
                : `只会在已选 ${selection.length} 条内容中生成成果。`}
            </p>
            {selection.length > 0 && (
              <button
                className="mt-5 rounded-xl border border-white/20 px-3 py-2 text-xs text-white hover:bg-white/10"
                onClick={() => setSelectedIds([])}
                type="button"
              >
                清除选择
              </button>
            )}
          </aside>
        </div>
      </section>

      {category.data.subcategories.length > 0 && (
        <section className="mt-8">
          <p className="text-xs font-medium text-muted">也可以直接进入目标小类</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {category.data.subcategories.map((subcategory) => (
              <Link
                className="rounded-full border border-line bg-paper px-3 py-2 text-xs text-muted hover:border-ink/30 hover:text-ink"
                key={subcategory.id}
                to={`/category/${subcategory.id}`}
              >
                {subcategory.name} · {subcategory.video_count}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow w-fit">范围内容</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">选择要参与本次成果的视频</h2>
          </div>
          <span className="text-xs text-faint">不选择时使用整个类目</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {category.data.videos.map((video) => (
            <SelectableVideo
              checked={selection.includes(video.id)}
              disabled={video.status !== "ready"}
              key={video.id}
              onToggle={() => toggleVideo(video.id)}
              video={video}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function SelectableVideo({
  video,
  checked,
  disabled,
  onToggle,
}: {
  video: VideoCard;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <article className={`min-w-0 overflow-hidden rounded-3xl border bg-paper shadow-whisper ${checked ? "border-accent ring-1 ring-accent/20" : "border-line"} ${disabled ? "opacity-55" : ""}`}>
      <button
        aria-checked={checked}
        aria-label={`选择：${video.title}`}
        className={`relative flex w-full min-w-0 gap-4 p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${disabled ? "" : "cursor-pointer"}`}
        disabled={disabled}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onToggle();
        }}
        role="checkbox"
        type="button"
      >
        <span className={`grid size-10 shrink-0 place-items-center rounded-2xl ${checked ? "bg-accent text-white" : "bg-disabled text-faint"}`}>
          {checked ? <CheckIcon className="size-4" /> : <VideoIcon className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{video.title}</span>
          <span className="mt-1 block text-[11px] text-faint">{video.author || "作者未知"}</span>
          <span className="mt-2 line-clamp-2 block text-xs leading-5 text-muted">
            {video.purpose_line || "等待视频理解完成"}
          </span>
          {video.content_types.length > 0 && (
            <span className="mt-3 flex flex-wrap gap-1.5" aria-label="内容类型">
              {video.content_types.slice(0, 3).map((contentType) => (
                <span className="rounded-full bg-canvas px-2 py-1 text-[10px] text-faint" key={contentType}>{contentType}</span>
              ))}
            </span>
          )}
        </span>
      </button>
      <div className="border-t border-line px-4 py-3">
        {video.source_url ? (
          <a className="text-[11px] font-medium text-accent hover:underline" href={video.source_url} rel="noreferrer" target="_blank">
            查看原视频来源
          </a>
        ) : (
          <p className="text-[11px] text-faint">原视频链接未知 · AI 不猜测</p>
        )}
      </div>
    </article>
  );
}

function CategoryLoading() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
      <div className="h-72 animate-pulse rounded-[28px] border border-line bg-paper" aria-label="正在读取收藏范围" />
    </div>
  );
}

function CategoryError({ title, detail, onRetry }: { title: string; detail: string; onRetry?: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-6 py-20 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">
        <CollectionIcon className="size-5" />
      </span>
      <h1 className="mt-5 text-3xl font-semibold tracking-[-0.04em]">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-muted">{detail}</p>
      <div className="mt-7 flex justify-center gap-3">
        {onRetry && <button className="primary-button" onClick={onRetry} type="button">重新读取</button>}
        <Link className="rounded-xl border border-line bg-paper px-4 py-3 text-xs font-semibold" to="/">返回收藏夹</Link>
      </div>
    </div>
  );
}
