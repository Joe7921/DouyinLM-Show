import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, type ReactNode, useMemo, useState } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";

import { ApiRequestError, api } from "./api";
import { useCollection, useReadyHealth } from "./application/useCollection";
import {
  ArrowIcon,
  BackIcon,
  CheckIcon,
  CollectionIcon,
  FileIcon,
  PulseIcon,
  RefreshIcon,
  SparklesIcon,
  UploadIcon,
  VideoIcon,
} from "./components/Icons";
import { useGateway } from "./data/gatewayContext";
import { CategoryPage } from "./features/category/CategoryPage";
import { VibeLauncher } from "./features/work-launcher/VibeLauncher";
import { RecentWorkspaces } from "./features/workspace/RecentWorkspaces";
import { WorkspacePage } from "./features/workspace/WorkspacePage";
import type {
  CategoryCard,
  ComponentHealth,
  JobCard,
  ProviderStatus,
  VideoCard,
} from "./types";

const ACTIVE_VIDEO_STATES = new Set([
  "queued",
  "processing",
  "transcribing",
  "understanding",
  "classifying",
]);

function AppShell() {
  const gateway = useGateway();

  return (
    <div className="app-root min-h-screen text-ink">
      <header className="sticky top-0 z-20 border-b border-line/70 bg-paper/82 backdrop-blur-xl">
        <div className="mx-auto flex h-18 max-w-6xl items-center justify-between gap-2 px-4 sm:px-8">
          <Link className="group flex min-w-0 items-center gap-2 sm:gap-3" to="/">
            <span className="brand-mark grid size-8 shrink-0 place-items-center rounded-xl bg-ink text-canvas shadow-soft transition-transform group-hover:-rotate-3 sm:size-9">
              <SparklesIcon className="size-4.5" />
            </span>
            <span>
              <span className="block text-[15px] font-semibold tracking-[-0.02em]">douyinLM</span>
              <span className="hidden text-[10px] tracking-[0.16em] text-muted uppercase sm:block">
                Local workspace
              </span>
            </span>
          </Link>

          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            <span className={`rounded-full px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.08em] uppercase ${gateway.mode === "mock" ? "bg-amber-100 text-amber-dark" : "bg-sage-soft text-sage-dark"}`}>
              {gateway.mode === "mock" ? "Mock 数据" : "Live"}
            </span>
            <nav className="flex items-center gap-1 text-[11px] sm:text-xs">
              <NavItem to="/" label="收藏夹" />
              <UtilityNavItem to="/ops/import" label="导入" />
              <UtilityNavItem to="/ops/diagnostics" label="诊断" />
            </nav>
          </div>
        </div>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/category/:id" element={<CategoryPage />} />
          <Route path="/workspace/:id" element={<WorkspacePage />} />
          <Route path="/ops/import" element={<ImportPage />} />
          <Route path="/ops/diagnostics" element={<DiagnosticsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  );
}

function UtilityNavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink className={({ isActive }) => `hidden px-2 py-2 sm:block ${isActive ? "text-ink" : "text-faint hover:text-muted"}`} to={to}>
      {label}
    </NavLink>
  );
}

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      className={({ isActive }) =>
        `whitespace-nowrap rounded-full px-2.5 py-2 transition-colors sm:px-3.5 ${
          isActive ? "bg-ink text-white" : "text-muted hover:text-ink"
        }`
      }
      end={to === "/"}
      to={to}
    >
      {label}
    </NavLink>
  );
}

function HomePage() {
  const collection = useCollection();
  const ready = useReadyHealth();
  const videos = collection.data?.videos ?? [];
  const categories = collection.data?.categories ?? [];
  const isEmpty = !collection.isPending && videos.length === 0;
  const processingCount = videos.filter((video) => ACTIVE_VIDEO_STATES.has(video.status)).length;
  const readyCount = videos.filter((video) => video.status === "ready").length;

  return (
    <div className="home-frame mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <section className="hero-shell animate-rise overflow-hidden rounded-[28px] border border-line bg-paper shadow-soft">
        <div className="grid min-w-0 gap-0 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="hero-copy min-w-0 p-6 sm:p-9 lg:p-11">
            <div className="mb-8 flex flex-wrap items-center gap-2">
              <span className="eyebrow">赛事演示收藏夹 · 授权材料待复核</span>
              <span className="status-dot">
                <span
                  className={`live-dot size-1.5 rounded-full ${ready.data?.status === "ready" ? "bg-sage" : "bg-amber"}`}
                />
                {processingCount > 0
                  ? `${processingCount} 条内容正在后台理解`
                  : ready.data?.status === "ready"
                    ? "本地服务已就绪"
                    : "正在连接本地服务"}
              </span>
            </div>

            <h1 className="max-w-2xl text-[32px] leading-[1.08] font-semibold tracking-[-0.045em] sm:text-5xl lg:text-[58px]">
              收藏不再是终点，<span className="text-accent">而是行动的上下文。</span>
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-7 text-muted sm:text-base">
              当前视频由团队预先导入并经作品流水线理解。真实产品中，用户正常收藏后，AI 会在后台完成这些工作。
            </p>

            <CollectionStats readyCount={readyCount} categoryCount={categories.length} workspaceCount={collection.data?.recent_workspaces.length ?? 0} />
            <VibeLauncher hasVideos={videos.length > 0} />
          </div>

          <div className="intelligence-panel relative min-h-64 min-w-0 overflow-hidden border-t border-line bg-ink p-7 text-white lg:border-t-0 lg:border-l">
            <div className="relative flex h-full flex-col justify-between gap-8">
              <div className="flex items-center justify-between gap-3 text-[10px] tracking-[0.08em] text-white/50 uppercase sm:text-xs sm:tracking-[0.15em]">
                <span>Collection intelligence</span>
                <span>抖音精选原生能力提案</span>
              </div>
              <div>
                <p className="max-w-xs text-2xl leading-snug font-medium tracking-[-0.025em]">
                  在收藏夹中
                  <br />
                  VibeCoding
                </p>
                <div className="mt-8 space-y-3">
                  <InsightRow label="已解析视频" value={`${readyCount}/${videos.length || 6}`} accent="sage" />
                  <InsightRow label="自动主题" value={`${categories.length || 0}`} accent="accent" />
                  <InsightRow label="最近成果" value={`${collection.data?.recent_workspaces.length ?? 0}`} accent="amber" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <MiniStage index="01" label="理解" active={videos.length > 0} />
                <MiniStage index="02" label="组织" active={categories.length > 0} />
                <MiniStage index="03" label="行动" active={Boolean(collection.data?.recent_workspaces.length)} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <EvidenceWall />

      {videos.length > 0 && (
        <section className="mt-9 animate-rise-delay">
          <SectionHeading
            eyebrow="授权收藏夹"
            title={`首页直接展示 ${videos.length} 条真实视频`}
            aside="关键帧与理解结果均来自同一解析流水线"
          />
          <div className="video-gallery grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {videos.map((video) => (
              <VideoTile key={`home-${video.id}`} video={video} />
            ))}
          </div>
        </section>
      )}

      <RecentWorkspaces workspaces={collection.data?.recent_workspaces ?? []} />

      {categories.length > 0 && (
        <section className="mt-10 animate-rise-delay">
          <SectionHeading
            eyebrow="AI 大类"
            title="收藏已经自动形成上下文"
            aside={`${categories.length} 个主题 · 无需手动整理`}
          />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {categories.map((category, index) => (
              <CategoryTile category={category} index={index} key={category.id} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-10 grid gap-5 lg:grid-cols-[1fr_320px]">
        <div>
          <SectionHeading
            eyebrow="收藏内容"
            title={isEmpty ? "你的收藏空间" : "真实状态持续可查"}
            aside={processingCount > 0 ? `${processingCount} 条理解中` : "不会用 Mock 替代失败"}
          />

          {collection.isPending ? (
            <LoadingCard />
          ) : collection.isError ? (
            <ErrorCard onRetry={() => void collection.refetch()} />
          ) : isEmpty ? (
            <EmptyCollection />
          ) : (
            <OperationSummary videos={videos} readyStatus={ready.data?.status} />
          )}
        </div>

        <HealthAside ready={ready.data} />
      </section>

      <footer className="mt-14 flex flex-col gap-2 border-t border-line py-6 text-xs text-faint sm:flex-row sm:items-center sm:justify-between">
        <span>不展示人工编写的主旨或分类；失败会保留原视频并给出真实原因。</span>
        <span>douyinLM · Local-first Web</span>
      </footer>
    </div>
  );
}

function EvidenceWall() {
  return (
    <section className="mt-9 animate-rise-delay">
      <SectionHeading
        eyebrow="交付证据墙"
        title="不只是首页，整条编译链路已经接起来"
        aside="以下为代码、测试与运行记录支持的状态"
      />
      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="evidence-panel rounded-[28px] border border-line bg-paper p-5 shadow-soft sm:p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <EvidenceCard
              label="T2/T3 主闭环"
              title="目标 → 选片 → 任务卡 → 来源 → 修改"
              detail="首页/类目目标、采用/排除、最多一次追问、三阶段任务卡、勾选、来源和一句话 Revision 已实现。"
              status="已实现"
            />
            <EvidenceCard
              label="强契约"
              title="Mock / Live 共用 DouyinLMGateway"
              detail="生产强制 Live；真实接口失败不静默回退 Mock；页面不直接导入 fixture。"
              status="已验证"
            />
            <EvidenceCard
              label="发布质量"
              title="38 项产品测试 + 5 项证据审计"
              detail="前端生产构建 101 个模块，敏感标记 0，source map 0。"
              status="已通过"
            />
            <EvidenceCard
              label="真实失败"
              title="Ark busy 不发布半成品"
              detail="真实 Provider 繁忙时保留失败、0 Artifact、0 Mock 回退，避免把演示效果做成伪结果。"
              status="已记录"
            />
          </div>
        </div>

        <div className="rounded-[28px] border border-line bg-ink p-5 text-white shadow-soft sm:p-6">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-white/40 uppercase">AI workflow</p>
          <div className="mt-5 space-y-3">
            <WorkflowStep index="01" title="视频理解与两级分类" detail="FFmpeg / ASR / 多模态理解形成收藏上下文" />
            <WorkflowStep index="02" title="范围继承与证据筛选" detail="LaunchScope 保留 Home / 类目 / 单条 / 多选边界" />
            <WorkflowStep index="03" title="Collection Artifact Compiler" detail="把目标编译成三阶段现场拍摄任务卡" />
            <WorkflowStep index="04" title="Provenance Validator" detail="区分 Video / Web / Inference，来源缺失不补写" />
            <WorkflowStep index="05" title="同一成果继续修改" detail="Revision 保持 Artifact ID，版本递增，勾选状态保留" />
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <ArtifactPreview />
        <DeliveryMatrix />
      </div>
    </section>
  );
}

function EvidenceCard({
  label,
  title,
  detail,
  status,
}: {
  label: string;
  title: string;
  detail: string;
  status: string;
}) {
  return (
    <article className="evidence-card rounded-2xl border border-line bg-white/72 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold tracking-[0.12em] text-faint uppercase">{label}</span>
        <span className="rounded-full bg-sage-soft px-2 py-1 text-[10px] font-semibold text-sage-dark">{status}</span>
      </div>
      <h3 className="mt-3 text-base font-semibold tracking-[-0.025em]">{title}</h3>
      <p className="mt-2 text-xs leading-5 text-muted">{detail}</p>
    </article>
  );
}

function WorkflowStep({ index, title, detail }: { index: string; title: string; detail: string }) {
  return (
    <div className="workflow-step flex gap-3 rounded-2xl border border-white/10 bg-white/[0.06] p-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/10 text-[11px] font-semibold text-white/64">{index}</span>
      <span>
        <strong className="block text-sm font-semibold">{title}</strong>
        <span className="mt-1 block text-xs leading-5 text-white/56">{detail}</span>
      </span>
    </div>
  );
}

function ArtifactPreview() {
  const sections = [
    ["拍摄前", "确认主体风格、服装颜色、机位和道具优先级"],
    ["到场后", "按光线方向先定背景，再处理人物站位和动作"],
    ["拍完后", "回看 3 张样片，保留一条可现场复拍的修改建议"],
  ];

  return (
    <article className="artifact-preview rounded-[28px] border border-line bg-paper p-5 shadow-whisper sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.14em] text-accent uppercase">Artifact 形态预览</p>
          <h3 className="mt-2 text-xl font-semibold tracking-[-0.035em]">三阶段现场拍摄任务卡</h3>
        </div>
        <span className="rounded-full border border-line bg-canvas px-2.5 py-1.5 text-[10px] text-muted">
          示例结构 · 不冒充实时生成
        </span>
      </div>
      <div className="mt-5 space-y-3">
        {sections.map(([title, detail], index) => (
          <div className="rounded-2xl border border-line bg-white/70 p-4" key={title}>
            <div className="flex items-start gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-accent-soft text-xs font-semibold text-accent">
                {index + 1}
              </span>
              <div>
                <h4 className="text-sm font-semibold">{title}</h4>
                <p className="mt-1 text-xs leading-5 text-muted">{detail}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="rounded-full border border-line bg-canvas px-2 py-1 text-[10px] text-faint">Video</span>
                  <span className="rounded-full border border-line bg-canvas px-2 py-1 text-[10px] text-faint">Inference</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function DeliveryMatrix() {
  const rows = [
    ["可操作 Web", "同源 Live 产品、本地 FastAPI + SQLite"],
    ["独立能力", "Collection Artifact Compiler Skill / Schema / 示例"],
    ["真实内容", "6 条摄影教程已解析，授权材料仍待补齐审计"],
    ["失败兜底", "Provider 忙、配置阻塞、来源不匹配均不发布伪成果"],
    ["待复验项", "真实来源清单、真人 A/B、10 次稳定 Live 演练"],
  ];

  return (
    <article className="rounded-[28px] border border-line bg-paper p-5 shadow-whisper sm:p-6">
      <p className="text-[10px] font-semibold tracking-[0.14em] text-faint uppercase">Delivery matrix</p>
      <h3 className="mt-2 text-xl font-semibold tracking-[-0.035em]">评委能看到的工程面</h3>
      <div className="mt-5 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white/72">
        {rows.map(([label, detail]) => (
          <div className="grid gap-2 px-4 py-3 sm:grid-cols-[120px_1fr]" key={label}>
            <span className="text-xs font-semibold text-ink">{label}</span>
            <span className="text-xs leading-5 text-muted">{detail}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

function CollectionStats({
  readyCount,
  categoryCount,
  workspaceCount,
}: {
  readyCount: number;
  categoryCount: number;
  workspaceCount: number;
}) {
  return (
    <div className="mt-7 grid max-w-xl grid-cols-3 gap-2.5">
      <HeroStat label="已理解" value={readyCount} />
      <HeroStat label="主题" value={categoryCount} />
      <HeroStat label="成果" value={workspaceCount} />
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="hero-stat rounded-2xl border border-line bg-white/70 px-3 py-3 shadow-innerline">
      <strong className="block text-xl font-semibold tabular-nums tracking-[-0.03em]">{value}</strong>
      <span className="mt-1 block text-[10px] font-medium tracking-[0.1em] text-faint uppercase">{label}</span>
    </div>
  );
}

function InsightRow({ label, value, accent }: { label: string; value: string; accent: "sage" | "accent" | "amber" }) {
  const color = accent === "sage" ? "bg-sage" : accent === "accent" ? "bg-accent" : "bg-amber";
  return (
    <div className="insight-row flex items-center justify-between gap-4 rounded-2xl border border-white/12 bg-white/[0.07] px-4 py-3">
      <span className="flex items-center gap-2 text-xs text-white/64">
        <span className={`size-1.5 rounded-full ${color}`} />
        {label}
      </span>
      <strong className="text-sm font-semibold tabular-nums">{value}</strong>
    </div>
  );
}

function MiniStage({ index, label, active }: { index: string; label: string; active: boolean }) {
  return (
    <div className={`stage-tile rounded-xl border p-3 backdrop-blur ${active ? "border-white/25 bg-white/12" : "border-white/10 bg-white/5"}`}>
      <span className="block text-[10px] text-white/35">{index}</span>
      <span className={`mt-1 block ${active ? "text-white" : "text-white/65"}`}>{label}</span>
    </div>
  );
}

function SectionHeading({ eyebrow, title, aside }: { eyebrow: string; title: string; aside: string }) {
  return (
    <div className="section-heading mb-4 flex items-end justify-between gap-4">
      <div>
        <p className="eyebrow w-fit">{eyebrow}</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">{title}</h2>
      </div>
      <span className="hidden text-right text-xs text-faint sm:block">{aside}</span>
    </div>
  );
}

function CategoryTile({ category, index }: { category: CategoryCard; index: number }) {
  const color = ["bg-accent-soft text-accent", "bg-sage-soft text-sage-dark", "bg-amber-100 text-amber-dark"][index % 3];
  return (
    <article className="category-card group rounded-3xl border border-line bg-paper p-5 shadow-whisper transition-transform hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-4">
        <span className={`grid size-10 place-items-center rounded-2xl ${color}`}>
          <CollectionIcon className="size-4.5" />
        </span>
        <span className="text-xs text-faint">{category.video_count} 条</span>
      </div>
      <h3 className="mt-5 text-lg font-semibold tracking-[-0.025em]">{category.name}</h3>
      <p className="mt-1.5 min-h-10 text-sm leading-5 text-muted">{category.purpose}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {category.subcategories.map((subcategory) => (
          <Link className="rounded-full border border-line bg-canvas px-2.5 py-1.5 text-[11px] text-muted hover:border-ink/30 hover:text-ink" key={subcategory.id} title={subcategory.purpose} to={`/category/${subcategory.id}`}>
            {subcategory.name} · {subcategory.video_count}
          </Link>
        ))}
      </div>
      <Link className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-ink hover:text-accent" to={`/category/${category.id}`}>
        用这个主题开始
        <ArrowIcon className="size-3.5" />
      </Link>
    </article>
  );
}

function VideoTile({ video }: { video: VideoCard }) {
  const status = videoStatus(video.status);
  return (
    <article className="video-card group overflow-hidden rounded-3xl border border-line bg-paper shadow-whisper">
      <div className="relative aspect-[16/9] overflow-hidden bg-disabled">
        {video.thumbnail_url ? (
          <img alt="" className="size-full object-cover transition duration-500 group-hover:scale-[1.035]" src={video.thumbnail_url} />
        ) : (
          <div className="grid size-full place-items-center text-faint">
            <VideoIcon className="size-7" />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/42 to-transparent" />
        <span className={`absolute top-3 left-3 rounded-full px-2.5 py-1 text-[10px] font-semibold shadow-whisper ${status.className}`}>
          {status.label}
        </span>
        {video.duration_ms && <span className="absolute right-3 bottom-3 rounded-full bg-black/55 px-2 py-1 text-[10px] font-medium text-white backdrop-blur">{formatDuration(video.duration_ms)}</span>}
      </div>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="mb-1 text-[9px] font-semibold tracking-[0.12em] text-accent uppercase">
              AI 标题
            </p>
            <h3 className="line-clamp-2 text-[15px] font-semibold leading-5">
              {video.purpose_line || video.title}
            </h3>
            <p className="mt-1 text-[11px] text-faint">{video.author || "作者未知"}</p>
          </div>
        </div>
        <p className={`mt-4 line-clamp-3 text-sm leading-6 ${video.summary ? "text-muted" : "text-faint"}`}>
          {video.summary || video.error_message || status.description}
        </p>
        {video.content_types.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2" aria-label="内容类型">
            {video.content_types.slice(0, 4).map((contentType) => (
              <span className="rounded-full border border-line bg-canvas px-2.5 py-1 text-[10px] text-muted" key={contentType}>
                {contentType}
              </span>
            ))}
          </div>
        )}
        {video.source_url ? (
          <a className="mt-4 inline-flex text-[11px] font-medium text-accent hover:underline" href={video.source_url} rel="noreferrer" target="_blank">
            查看原视频来源
          </a>
        ) : (
          <p className="mt-4 text-[11px] text-faint">原视频链接未知 · AI 不猜测</p>
        )}
      </div>
    </article>
  );
}

function OperationSummary({ videos, readyStatus }: { videos: VideoCard[]; readyStatus?: string }) {
  const readyCount = videos.filter((video) => video.status === "ready").length;
  const issueCount = videos.filter((video) => video.status === "failed" || video.status === "needs_configuration").length;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <SummaryMetric label="解析完成" value={`${readyCount}/${videos.length}`} detail="只展示真实流水线结果" tone="sage" />
      <SummaryMetric label="服务状态" value={readyStatus === "ready" ? "Ready" : "检查中"} detail="本地 API 决定页面事实" tone="accent" />
      <SummaryMetric label="需处理" value={issueCount} detail="失败会保留原因" tone="amber" />
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string | number;
  detail: string;
  tone: "sage" | "accent" | "amber";
}) {
  const toneClass = tone === "sage" ? "text-sage-dark" : tone === "accent" ? "text-accent" : "text-amber-dark";
  return (
    <article className="summary-card rounded-2xl border border-line bg-paper p-5 shadow-whisper">
      <p className="text-[10px] font-medium tracking-[0.12em] text-faint uppercase">{label}</p>
      <strong className={`mt-3 block text-2xl font-semibold tracking-[-0.03em] ${toneClass}`}>{value}</strong>
      <p className="mt-2 text-xs leading-5 text-muted">{detail}</p>
    </article>
  );
}

function EmptyCollection() {
  return (
    <div className="group relative overflow-hidden rounded-3xl border border-dashed border-line-strong bg-paper p-7 sm:p-9">
      <div className="absolute top-0 right-0 size-40 rounded-full bg-accent-soft opacity-0 blur-3xl transition-opacity group-hover:opacity-100" />
      <div className="relative flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent">
            <CollectionIcon className="size-5" />
          </span>
          <div>
            <h3 className="text-lg font-semibold tracking-[-0.025em]">收藏夹还没有内容</h3>
            <p className="mt-1.5 max-w-md text-sm leading-6 text-muted">
              导入已获许可的真实视频后，作品会自己完成解析和分类。你不需要创建文件夹或维护标签。
            </p>
          </div>
        </div>
        <Link className="primary-button" to="/ops/import">
          <UploadIcon className="size-4" />
          导入真实视频
        </Link>
      </div>
    </div>
  );
}

function HealthAside({ ready }: { ready?: { status: string; database: ComponentHealth; job_runner: ComponentHealth } }) {
  return (
    <aside className="h-fit rounded-3xl border border-line bg-paper p-5 shadow-whisper">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-sage-soft text-sage-dark">
          <PulseIcon className="size-4.5" />
        </span>
        <div>
          <p className="text-sm font-semibold">本地运行状态</p>
          <p className="text-[11px] text-faint">导入和解析不打断收藏浏览</p>
        </div>
      </div>
      <div className="mt-5 space-y-2.5">
        <HealthRow label="FastAPI 服务" health={{ ok: ready?.status === "ready", detail: "127.0.0.1:8765" }} />
        <HealthRow label="SQLite 数据库" health={ready?.database} />
        <HealthRow label="后台任务器" health={ready?.job_runner} />
      </div>
      <Link className="mt-5 flex items-center justify-between rounded-xl border border-line px-3.5 py-3 text-xs font-medium transition-colors hover:border-ink/30 hover:bg-canvas" to="/ops/diagnostics">
        查看完整诊断
        <ArrowIcon className="size-4" />
      </Link>
    </aside>
  );
}

function LoadingCard() {
  return (
    <div className="animate-pulse rounded-3xl border border-line bg-paper p-8">
      <div className="h-5 w-40 rounded bg-disabled" />
      <div className="mt-3 h-4 w-72 max-w-full rounded bg-disabled" />
    </div>
  );
}

function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-3xl border border-red-200 bg-red-50 p-7">
      <p className="text-sm font-semibold text-red-900">无法读取本地收藏夹</p>
      <button className="mt-3 text-xs font-medium text-red-700 underline" onClick={onRetry} type="button">
        重新连接
      </button>
    </div>
  );
}

function HealthRow({ label, health }: { label: string; health?: ComponentHealth }) {
  const ok = health?.ok === true;
  return (
    <div className="flex items-center justify-between rounded-xl bg-canvas px-3.5 py-3">
      <span className="text-xs text-muted">{label}</span>
      <span className={`flex items-center gap-1.5 text-[11px] font-medium ${ok ? "text-sage-dark" : "text-amber-dark"}`}>
        <span className={`size-1.5 rounded-full ${ok ? "bg-sage" : "bg-amber"}`} />
        {ok ? "正常" : "检查中"}
      </span>
    </div>
  );
}

function ImportPage() {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [manifestJson, setManifestJson] = useState('{"schema_version":1,"videos":[]}');
  const [manifestName, setManifestName] = useState<string | null>(null);
  const [permissionScope, setPermissionScope] = useState("下载、AI 处理、Web 展示与现场演示");
  const [permissionConfirmed, setPermissionConfirmed] = useState(false);
  const providers = useQuery({ queryKey: ["providers"], queryFn: api.providers });
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: api.jobs, refetchInterval: 1200 });
  const importMutation = useMutation({
    mutationFn: api.importVideos,
    onSuccess: async () => {
      setFiles([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["collection"] }),
      ]);
    },
  });
  const retryMutation = useMutation({
    mutationFn: api.retryJob,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });

  const selectedSize = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);
  const canSubmit = files.length > 0 && permissionConfirmed && permissionScope.trim().length > 0 && !importMutation.isPending;
  const errorMessage = importMutation.error instanceof ApiRequestError ? importMutation.error.message : null;

  const readManifest = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      JSON.parse(text);
      setManifestJson(text);
      setManifestName(file.name);
    } catch {
      setManifestName("清单格式无效");
    }
  };

  return (
    <PageFrame title="让真实收藏进入理解流水线" eyebrow="Gate T1 · Import">
      <p className="max-w-2xl text-base leading-7 text-muted">
        这里只导入已经获得许可的视频。导入立即返回，FFmpeg、ASR、视频理解和自动分类都在后台完成。
      </p>

      <div className="mt-7 flex flex-wrap gap-2">
        <ProviderPill label="FFmpeg" status={providers.data?.ffmpeg} />
        <ProviderPill label="豆包 ASR" status={providers.data?.asr} />
        <ProviderPill label="方舟 Seed 2.0" status={providers.data?.ark} />
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-3xl border border-line bg-paper p-5 shadow-whisper sm:p-7">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-2xl bg-accent-soft text-accent">
              <UploadIcon className="size-4.5" />
            </span>
            <div>
              <h2 className="font-semibold">选择授权视频</h2>
              <p className="mt-0.5 text-xs text-faint">MP4 / MOV / MKV / WebM，可一次多选</p>
            </div>
          </div>

          <label className="mt-6 flex cursor-pointer flex-col items-center rounded-2xl border border-dashed border-line-strong bg-canvas px-5 py-10 text-center transition-colors hover:border-accent/50 hover:bg-accent-soft/30">
            <VideoIcon className="size-7 text-accent" />
            <span className="mt-3 text-sm font-semibold">点击选择本地视频</span>
            <span className="mt-1 text-xs text-faint">原件只读保存，文件名不会作为 AI 事实</span>
            <input
              accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.mp4,.mov,.mkv,.webm"
              className="sr-only"
              multiple
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              type="file"
            />
          </label>

          {files.length > 0 && (
            <div className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line">
              {files.map((file) => (
                <div className="flex items-center justify-between gap-4 px-4 py-3" key={`${file.name}-${file.size}`}>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">{file.name}</p>
                    <p className="mt-0.5 text-[10px] text-faint">{formatBytes(file.size)}</p>
                  </div>
                  <CheckIcon className="size-4 shrink-0 text-sage" />
                </div>
              ))}
            </div>
          )}

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium">sidecar 元数据清单（可选）</span>
              <span className="mt-1 block text-[11px] leading-4 text-faint">原标题、作者和原链接只从清单读取，AI 不猜。</span>
              <span className="mt-2 flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-canvas px-3.5 py-3 text-xs text-muted hover:border-ink/30">
                <FileIcon className="size-4" />
                {manifestName || "选择 manifest.json"}
                <input accept="application/json,.json" className="sr-only" onChange={(event) => void readManifest(event)} type="file" />
              </span>
            </label>
            <label className="block">
              <span className="text-xs font-medium">许可范围</span>
              <span className="mt-1 block text-[11px] leading-4 text-faint">每条素材都会保存这份许可记录。</span>
              <input className="mt-2 w-full rounded-xl border border-line bg-canvas px-3.5 py-3 text-xs outline-none transition-colors focus:border-accent" onChange={(event) => setPermissionScope(event.target.value)} value={permissionScope} />
            </label>
          </div>

          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-canvas p-4">
            <input checked={permissionConfirmed} className="mt-0.5 size-4 accent-[#eb553c]" onChange={(event) => setPermissionConfirmed(event.target.checked)} type="checkbox" />
            <span className="text-xs leading-5 text-muted">我确认这些视频可用于下载、AI 处理、Web 展示及本次比赛现场演示。</span>
          </label>

          {errorMessage && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-xs text-red-800">{errorMessage}</p>}
          {importMutation.isSuccess && <p className="mt-4 rounded-xl bg-sage-soft px-4 py-3 text-xs text-sage-dark">导入成功，已转入后台理解。</p>}

          <button
            className="primary-button mt-5 w-full disabled:cursor-not-allowed disabled:opacity-35"
            disabled={!canSubmit}
            onClick={() => importMutation.mutate({ files, manifestJson, permissionScope })}
            type="button"
          >
            <UploadIcon className="size-4" />
            {importMutation.isPending ? "正在安全导入…" : `导入 ${files.length || 0} 条视频${selectedSize ? ` · ${formatBytes(selectedSize)}` : ""}`}
          </button>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="eyebrow w-fit">后台异步</p>
              <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">理解进度</h2>
            </div>
            <RefreshIcon className="size-4 text-faint" />
          </div>
          <div className="space-y-3">
            {jobs.data?.jobs.length ? (
              jobs.data.jobs.map((job) => (
                <JobTile job={job} key={job.id} onRetry={() => retryMutation.mutate(job.id)} />
              ))
            ) : (
              <div className="rounded-3xl border border-dashed border-line-strong bg-paper p-6 text-sm text-muted">尚无解析任务。选择视频后，阶段进度会出现在这里。</div>
            )}
          </div>
        </section>
      </div>
    </PageFrame>
  );
}

function ProviderPill({ label, status }: { label: string; status?: ProviderStatus }) {
  const configured = status?.configured === true;
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs ${configured ? "border-sage/25 bg-sage-soft text-sage-dark" : "border-amber/25 bg-amber-50 text-amber-dark"}`} title={status?.detail ?? undefined}>
      <span className={`size-1.5 rounded-full ${configured ? "bg-sage" : "bg-amber"}`} />
      {label} · {configured ? "已就绪" : "待配置"}
    </span>
  );
}

function JobTile({ job, onRetry }: { job: JobCard; onRetry: () => void }) {
  const progress = job.latest_event?.progress ?? 0;
  const failed = job.status === "failed" || job.status === "blocked";
  const completed = job.status === "completed";
  return (
    <article className="rounded-3xl border border-line bg-paper p-5 shadow-whisper">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold">{completed ? "理解完成" : failed ? (job.status === "blocked" ? "等待配置" : "解析失败") : "正在理解视频"}</p>
          <p className="mt-1 text-[11px] leading-4 text-muted">{job.latest_event?.message || "等待后台任务器接管"}</p>
        </div>
        <span className="text-[10px] text-faint">{completed || failed ? job.status : `${progress}%`}</span>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-disabled">
        <div className={`h-full rounded-full transition-[width] duration-500 ${failed ? "bg-amber" : completed ? "bg-sage" : "bg-accent"}`} style={{ width: `${Math.max(progress, completed ? 100 : 3)}%` }} />
      </div>
      {failed && (
        <button className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-ink hover:text-accent" onClick={onRetry} type="button">
          <RefreshIcon className="size-3.5" />
          重新尝试
        </button>
      )}
    </article>
  );
}

function DiagnosticsPage() {
  const ready = useQuery({ queryKey: ["ready"], queryFn: api.ready, refetchInterval: 5_000 });
  const providers = useQuery({ queryKey: ["providers"], queryFn: api.providers, refetchInterval: 5_000 });

  const checks = [
    ["SQLite 数据库", ready.data?.database.ok, ready.data?.database.detail],
    ["本地文件目录", ready.data?.filesystem.ok, ready.data?.filesystem.detail],
    ["后台任务运行器", ready.data?.job_runner.ok, ready.data?.job_runner.detail],
    ["FFmpeg 8.1.2", providers.data?.ffmpeg.configured, providers.data?.ffmpeg.detail],
    ["火山方舟 Seed 2.0", providers.data?.ark.configured, providers.data?.ark.detail],
    ["豆包语音 ASR", providers.data?.asr.configured, providers.data?.asr.detail],
  ] as const;

  return (
    <PageFrame title="运行状态" eyebrow="Local diagnostics">
      <p className="max-w-2xl text-base leading-7 text-muted">
        本地基础设施始终可启动；缺少模型凭证时，导入任务会明确停在“等待配置”，不会生成伪结果。
      </p>
      <div className="mt-9 divide-y divide-line overflow-hidden rounded-3xl border border-line bg-paper">
        {checks.map(([label, ok, detail]) => (
          <div className="flex items-center justify-between gap-5 px-5 py-4 sm:px-6" key={label}>
            <div className="min-w-0">
              <p className="text-sm font-medium">{label}</p>
              <p className="mt-1 truncate text-xs text-faint">{detail ?? "正在检查"}</p>
            </div>
            <span className={`grid size-8 shrink-0 place-items-center rounded-full ${ok ? "bg-sage-soft text-sage-dark" : "bg-disabled text-faint"}`}>
              {ok ? <CheckIcon className="size-4" /> : <span className="size-1.5 rounded-full bg-current" />}
            </span>
          </div>
        ))}
      </div>
    </PageFrame>
  );
}

function PageFrame({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <Link className="mb-8 inline-flex items-center gap-2 text-xs font-medium text-muted hover:text-ink" to="/">
        <BackIcon className="size-4" />
        返回收藏夹
      </Link>
      <p className="eyebrow w-fit">{eyebrow}</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">{title}</h1>
      <div className="mt-5">{children}</div>
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <p className="eyebrow mx-auto w-fit">404</p>
      <h1 className="mt-5 text-3xl font-semibold tracking-[-0.04em]">这个工作区还不存在</h1>
      <Link className="primary-button mx-auto mt-7 w-fit" to="/">
        返回收藏夹
      </Link>
    </div>
  );
}

function videoStatus(status: string): { label: string; description: string; className: string } {
  const map: Record<string, { label: string; description: string; className: string }> = {
    ready: { label: "已理解", description: "AI 理解完成", className: "bg-sage-soft text-sage-dark" },
    queued: { label: "等待中", description: "等待后台理解", className: "bg-amber-50 text-amber-dark" },
    processing: { label: "校验中", description: "正在校验和生成衍生文件", className: "bg-amber-50 text-amber-dark" },
    transcribing: { label: "转写中", description: "正在生成带时间点的字幕", className: "bg-amber-50 text-amber-dark" },
    classifying: { label: "分类中", description: "正在自动组织收藏夹", className: "bg-amber-50 text-amber-dark" },
    needs_configuration: { label: "等待配置", description: "配置模型能力后可以继续", className: "bg-amber-50 text-amber-dark" },
    failed: { label: "需重试", description: "解析失败，原视频仍安全保留", className: "bg-red-50 text-red-800" },
  };
  return map[status] ?? { label: "理解中", description: "AI 正在理解这条视频", className: "bg-amber-50 text-amber-dark" };
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default AppShell;
