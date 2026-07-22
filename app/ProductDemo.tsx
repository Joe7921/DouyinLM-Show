"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";

const PHASES = [
  { key: "context", label: "收藏与目标", duration: 3800 },
  { key: "select", label: "选择与追问", duration: 4400 },
  { key: "artifact", label: "编译任务卡", duration: 5000 },
  { key: "revise", label: "来源与修改", duration: 5200 },
] as const;

const STAGE_COPY = [
  "收藏天然成为上下文，第一句话直接开始",
  "采用、排除和唯一一次追问都可检查",
  "把零散教程编译成现场可执行的 Artifact",
  "查看依据，并在同一成果上继续 Vibe",
] as const;

const VIDEOS = [
  { id: "01", title: "海边自然互动", detail: "走动、递物与自然表情", image: "/demo/video-seaside.jpg", adopted: true },
  { id: "02", title: "手机锁焦与曝光", detail: "锁定面部后微调亮度", image: "/demo/video-seaside-detail.jpg", adopted: true },
  { id: "03", title: "晴天人像构图", detail: "前景、地平线与人物位置", image: "/demo/video-lotus-detail.jpg", adopted: true },
  { id: "04", title: "餐厅弱光人像", detail: "光线场景不符", image: "/demo/video-restaurant.jpg", adopted: false },
  { id: "05", title: "荷花广角姿势", detail: "拍摄场景不符", image: "/demo/video-lotus.jpg", adopted: false },
  { id: "06", title: "室内氛围构图", detail: "缺少本次现场动作", image: "/demo/video-restaurant-detail.jpg", adopted: false },
] as const;

type PhaseKey = (typeof PHASES)[number]["key"];

export function ProductDemo() {
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [cycle, setCycle] = useState(0);
  const [checked, setChecked] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const phase = PHASES[phaseIndex];

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      setReducedMotion(media.matches);
      if (media.matches) setPlaying(false);
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!playing || reducedMotion) return;
    const timer = window.setTimeout(() => {
      if (phaseIndex === PHASES.length - 1) {
        setPlaying(false);
        return;
      }
      setPhaseIndex((current) => current + 1);
    }, phase.duration);
    return () => window.clearTimeout(timer);
  }, [phase.duration, phaseIndex, playing, reducedMotion]);

  const progress = useMemo(
    () => Math.round(((phaseIndex + 1) / PHASES.length) * 100),
    [phaseIndex],
  );

  const goTo = (index: number) => {
    setPhaseIndex(Math.min(Math.max(index, 0), PHASES.length - 1));
    setPlaying(false);
    setCycle((current) => current + 1);
  };

  const restart = () => {
    setPhaseIndex(0);
    setChecked(false);
    setCycle((current) => current + 1);
    setPlaying(!reducedMotion);
  };

  return (
    <section className="interactive-demo cinematic-demo" id="demo" aria-label="douyinLM 产品运行交互演绎">
      <header className="demo-topbar">
        <div className="demo-identity">
          <span className="window-logo">dL</span>
          <div><b>Collection Artifact Compiler</b><small>收藏内容 → 可执行成果</small></div>
        </div>
        <span className="simulation-label"><i /> 流程模拟 · 非实时 AI</span>
      </header>

      <div className="phase-rail cinematic-rail" role="tablist" aria-label="演示阶段">
        {PHASES.map((item, index) => (
          <button
            aria-label={`查看${item.label}阶段`}
            aria-selected={index === phaseIndex}
            className={index < phaseIndex ? "complete" : index === phaseIndex ? "active" : ""}
            key={item.key}
            onClick={() => goTo(index)}
            role="tab"
            type="button"
          >
            <span>{index < phaseIndex ? "✓" : String(index + 1).padStart(2, "0")}</span>
            <small>{item.label}</small>
          </button>
        ))}
        <div className="rail-line" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
      </div>

      <div className="demo-viewport cinematic-viewport" aria-live="polite">
        <div className={`demo-scene cinematic-scene scene-${phase.key}`} key={`${phase.key}-${cycle}`}>
          <Scene phase={phase.key} checked={checked} onCheck={() => setChecked((value) => !value)} onOpenSource={() => goTo(3)} />
        </div>
      </div>

      <footer className="demo-controls">
        <div className="stage-caption"><span>{String(phaseIndex + 1).padStart(2, "0")} / 04</span><p>{STAGE_COPY[phaseIndex]}</p></div>
        <div className="control-buttons">
          <button aria-label="上一步" disabled={phaseIndex === 0} onClick={() => goTo(phaseIndex - 1)} type="button">←</button>
          <button className="play-button" aria-label={playing ? "暂停演示" : "继续演示"} onClick={() => setPlaying((value) => !value)} type="button">{playing ? "Ⅱ" : "▶"}</button>
          <button aria-label="下一步" disabled={phaseIndex === PHASES.length - 1} onClick={() => goTo(phaseIndex + 1)} type="button">→</button>
          <button className="restart-button" onClick={restart} type="button">重播</button>
        </div>
      </footer>
      {playing && <div className="phase-timer" key={`${phase.key}-${cycle}`} style={{ animationDuration: `${phase.duration}ms` }} />}
    </section>
  );
}

function Scene({ phase, checked, onCheck, onOpenSource }: { phase: PhaseKey; checked: boolean; onCheck: () => void; onOpenSource: () => void }) {
  if (phase === "context") return <ContextScene />;
  if (phase === "select") return <SelectScene />;
  if (phase === "artifact") return <ArtifactScene checked={checked} onCheck={onCheck} onOpenSource={onOpenSource} />;
  return <RevisionScene checked={checked} />;
}

function ContextScene() {
  return (
    <div className="context-scene">
      <div className="collection-board">
        <header><div><span>AUTHORIZED COLLECTION</span><b>摄影教程收藏</b></div><em>6 条</em></header>
        <div className="video-mosaic">
          {VIDEOS.map((video, index) => <VideoTile key={video.id} video={video} index={index} />)}
        </div>
        <p><i /> 已授权、已预处理的真实收藏画面</p>
      </div>

      <div className="context-flow" aria-hidden="true"><span /><i>→</i></div>

      <div className="goal-card">
        <div className="goal-kicker"><span>01</span><p><b>说出目标</b><small>无需建项目，也不用重新整理</small></p></div>
        <p className="goal-copy">我准备在晴天白天去海边，用手机给朋友拍自然互动人像，生成一张现场拍摄任务卡。</p>
        <footer><span>范围 · 全部收藏</span><b>开始 Vibe <i>→</i></b></footer>
      </div>
    </div>
  );
}

function VideoTile({ video, index }: { video: (typeof VIDEOS)[number]; index: number }) {
  return (
    <article className="video-tile" style={{ "--tile-delay": `${index * 80}ms` } as CSSProperties}>
      <div className="video-image"><Image alt={`授权摄影教程：${video.title}`} fill priority={index < 3} sizes="(max-width: 680px) 24vw, 110px" src={video.image} /></div>
      <div><small>VIDEO {video.id}</small><b>{video.title}</b></div>
    </article>
  );
}

function SelectScene() {
  return (
    <div className="select-scene-v2">
      <SceneLead number="02" eyebrow="Scope resolver" title="AI 先做取舍，再决定是否需要追问" detail="不是把六条教程全部总结一遍，而是保留真正改变结果的内容。" />
      <div className="decision-board">
        <div className="decision-group adopted-group">
          <header><div><span>采用</span><b>3</b></div><small>直接支持海边手机人像</small></header>
          {VIDEOS.filter((video) => video.adopted).map((video, index) => <DecisionRow key={video.id} video={video} index={index} />)}
        </div>
        <div className="decision-group excluded-group">
          <header><div><span>排除</span><b>3</b></div><small>保留排除理由，不静默丢弃</small></header>
          {VIDEOS.filter((video) => !video.adopted).map((video, index) => <DecisionRow key={video.id} video={video} index={index} />)}
        </div>
      </div>
      <div className="clarify-strip">
        <span>AI · 唯一一次追问</span>
        <p>你会使用手机还是相机？<small>这会改变对焦方式和参数建议。</small></p>
        <b>手机 · 晴天白天 <i>✓</i></b>
      </div>
      <p className="scope-note"><i /> 范围未扩大 · 采用 3 · 排除 3 · 本次无需联网</p>
    </div>
  );
}

function DecisionRow({ video, index }: { video: (typeof VIDEOS)[number]; index: number }) {
  return (
    <article className="decision-row" style={{ "--row-delay": `${index * 110}ms` } as CSSProperties}>
      <div className="decision-thumb"><Image alt="" fill sizes="44px" src={video.image} /></div>
      <p><b>{video.title}</b><small>{video.detail}</small></p>
      <i>{video.adopted ? "✓" : "×"}</i>
    </article>
  );
}

function ArtifactScene({ checked, onCheck, onOpenSource }: { checked: boolean; onCheck: () => void; onOpenSource: () => void }) {
  return (
    <div className="artifact-scene-v2">
      <div className="compiler-lane">
        <SceneLead number="03" eyebrow="Artifact compiler" title="把收藏证据编译成行动成果" detail="按照现场顺序组织，同时校验每条关键建议的来源。" />
        <div className="compiler-stack">
          {["锁定收藏范围", "编译现场顺序", "校验关键来源"].map((item, index) => <div key={item} style={{ "--pass-delay": `${index * 260}ms` } as CSSProperties}><span>{index + 1}</span><p>{item}</p><i>完成</i></div>)}
        </div>
        <div className="compiler-status"><span><i /></span><p><b>Collection Artifact Compiler</b><small>同一 Artifact · 结构化输出</small></p><em>READY</em></div>
      </div>

      <TaskCard checked={checked} onCheck={onCheck} onOpenSource={onOpenSource} />
    </div>
  );
}

function TaskCard({ checked, onCheck, onOpenSource }: { checked: boolean; onCheck: () => void; onOpenSource: () => void }) {
  const sections = [
    { title: "拍摄前", items: ["清洁镜头并释放手机存储", "确认晴天白天与可拍区域"] },
    { title: "到场后", items: ["先让朋友自然走动，不急着看镜头", "强光时锁定面部，再微调曝光"] },
    { title: "拍完后", items: ["放大检查眼睛是否清晰", "保留动作自然的备选照片"] },
  ];
  return (
    <article className="task-card-v2">
      <header><div><small>SHOOTING TASK CARD · v1</small><h3>晴天海边自然互动人像</h3><p>现场可以直接照着完成的任务卡</p></div><span>8 项<br />3 阶段</span></header>
      <div className="task-sections">
        {sections.map((section, sectionIndex) => (
          <section key={section.title}>
            <header><span>{String(sectionIndex + 1).padStart(2, "0")}</span><b>{section.title}</b></header>
            {section.items.map((item, itemIndex) => {
              const interactive = sectionIndex === 2 && itemIndex === 0;
              const source = sectionIndex === 1 && itemIndex === 1;
              return (
                <div className={`task-item ${interactive && checked ? "done" : ""}`} key={item}>
                  <button aria-label={`勾选：${item}`} onClick={interactive ? onCheck : undefined} type="button">{interactive && checked ? "✓" : ""}</button>
                  <p>{item}</p>
                  {source ? <button className="source-pill" onClick={onOpenSource} type="button">VIDEO · 01:18</button> : <span className="source-pill">{sectionIndex === 0 ? "INFERENCE" : "VIDEO"}</span>}
                </div>
              );
            })}
          </section>
        ))}
      </div>
      <footer><button onClick={onCheck} type="button"><i className={checked ? "checked" : ""}>{checked ? "✓" : ""}</i>{checked ? "已完成一项" : "试着勾选"}</button><button onClick={onOpenSource} type="button">查看行动依据 <span>→</span></button></footer>
    </article>
  );
}

function RevisionScene({ checked }: { checked: boolean }) {
  const lines = ["镜头擦净，留足存储", "先走动互动，再看镜头", "锁脸后轻微降曝光", "拍完放大检查眼睛", "保留自然动作备选"];
  return (
    <div className="revision-scene-v2">
      <div className="provenance-panel">
        <SceneLead number="04" eyebrow="Provenance" title="每条关键行动，都能打开依据" detail="Video、Web 与 AI 综合有清晰边界。" />
        <div className="focus-action"><small>任务卡 · 到场后</small><b>强光时锁定面部，再微调曝光</b><span>3 条依据</span></div>
        <div className="source-list-v2">
          <SourceEntry kind="VIDEO" title="晴天手机人像" detail="01:18—01:31 · 面部对焦与曝光" image="/demo/video-seaside-detail.jpg" />
          <SourceEntry kind="VIDEO" title="海边自然互动" detail="00:42—00:56 · 锁定主体后微调" image="/demo/video-seaside.jpg" />
          <SourceEntry kind="INFERENCE" title="行动顺序由 AI 综合" detail="不伪造链接或创作者原话" />
        </div>
        <p className="web-status"><span>WEB</span><b>本次未联网</b><small>当前目标不需要动态事实</small></p>
      </div>

      <div className="revision-panel">
        <div className="revision-command-v2"><span>你</span><p>压缩成一屏小纸条</p><i>已发送</i></div>
        <div className="version-line"><span>v1</span><i>→</i><span>v2</span><p>Artifact ID 保持不变</p></div>
        <article className="compact-card-v2">
          <header><div><small>COMPACT VARIANT · v2</small><h3>海边人像 · 一屏小纸条</h3></div><span>5 行</span></header>
          <ol>{lines.map((line, index) => <li key={line}><i>{index + 1}</i><span>{line}</span>{checked && index === 3 ? <b>✓</b> : null}</li>)}</ol>
          <footer><span>来源关系已保留</span><b>{checked ? "勾选状态已保留" : "可继续修改"}</b></footer>
        </article>
        <p className="revision-success"><i /> 同一成果持续 Vibe，而不是重新生成第二份文档</p>
      </div>
    </div>
  );
}

function SourceEntry({ kind, title, detail, image }: { kind: "VIDEO" | "INFERENCE"; title: string; detail: string; image?: string }) {
  return (
    <article className={`source-entry-v2 ${kind.toLowerCase()}`}>
      {image ? <div><Image alt="" fill sizes="46px" src={image} /></div> : <span>AI</span>}
      <p><small>{kind}</small><b>{title}</b><em>{detail}</em></p>
      <i>↗</i>
    </article>
  );
}

function SceneLead({ number, eyebrow, title, detail }: { number: string; eyebrow: string; title: string; detail: string }) {
  return (
    <div className="scene-lead"><span>{number}</span><div><small>{eyebrow}</small><h3>{title}</h3><p>{detail}</p></div></div>
  );
}
