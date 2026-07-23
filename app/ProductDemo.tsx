"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";

const PHASES = [
  { key: "parse", label: "自动解析", duration: 4600 },
  { key: "context", label: "收藏与目标", duration: 3800 },
  { key: "select", label: "选择与追问", duration: 4400 },
  { key: "artifact", label: "编译任务卡", duration: 5000 },
  { key: "revise", label: "来源与修改", duration: 6200 },
] as const;

const STAGE_COPY = [
  "授权收藏在后台异步完成理解与两级分类",
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

const ARTIFACT_VARIANTS = [
  { key: "task", label: "现场任务卡", status: "当前主演示" },
  { key: "compact", label: "一屏小纸条", status: "演示形态" },
  { key: "compare", label: "对比决策表", status: "概念扩展演绎" },
  { key: "storyboard", label: "四镜分镜", status: "概念扩展演绎" },
] as const;

type PhaseKey = (typeof PHASES)[number]["key"];
type ArtifactVariantKey = (typeof ARTIFACT_VARIANTS)[number]["key"];

function randomArtifactIndex() {
  const value = new Uint32Array(1);
  window.crypto.getRandomValues(value);
  return value[0] % ARTIFACT_VARIANTS.length;
}

export function ProductDemo() {
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [cycle, setCycle] = useState(0);
  const [checked, setChecked] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [artifactVariantIndex, setArtifactVariantIndex] = useState(0);
  const [selectingArtifact, setSelectingArtifact] = useState(false);
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

  useEffect(() => {
    if (phaseIndex !== 3) return;
    const finalIndex = randomArtifactIndex();
    let step = 0;
    let roulette: number | undefined;
    const start = window.setTimeout(() => {
      if (reducedMotion) {
        setArtifactVariantIndex(finalIndex);
        setSelectingArtifact(false);
        return;
      }
      setSelectingArtifact(true);
      roulette = window.setInterval(() => {
        step += 1;
        setArtifactVariantIndex((current) => (current + 1) % ARTIFACT_VARIANTS.length);
        if (step >= 7) {
          window.clearInterval(roulette);
          setArtifactVariantIndex(finalIndex);
          setSelectingArtifact(false);
        }
      }, 150);
    }, 0);
    return () => {
      window.clearTimeout(start);
      if (roulette !== undefined) window.clearInterval(roulette);
    };
  }, [cycle, phaseIndex, reducedMotion]);

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
            <span>{index < phaseIndex ? "✓" : String(index).padStart(2, "0")}</span>
            <small>{item.label}</small>
          </button>
        ))}
        <div className="rail-line" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
      </div>

      <div className="demo-viewport cinematic-viewport" aria-live="polite">
        <div className={`demo-scene cinematic-scene scene-${phase.key}`} key={`${phase.key}-${cycle}`}>
          <Scene
            phase={phase.key}
            checked={checked}
            artifactVariant={ARTIFACT_VARIANTS[artifactVariantIndex].key}
            selectingArtifact={selectingArtifact}
            onCheck={() => setChecked((value) => !value)}
            onOpenSource={() => goTo(4)}
            onShuffleArtifact={() => {
              setArtifactVariantIndex((current) => (current + 1 + randomArtifactIndex() % (ARTIFACT_VARIANTS.length - 1)) % ARTIFACT_VARIANTS.length);
              setSelectingArtifact(false);
            }}
          />
        </div>
      </div>

      <footer className="demo-controls">
        <div className="stage-caption"><span>{String(phaseIndex).padStart(2, "0")} / 04</span><p>{STAGE_COPY[phaseIndex]}</p></div>
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

function Scene({
  phase,
  checked,
  artifactVariant,
  selectingArtifact,
  onCheck,
  onOpenSource,
  onShuffleArtifact,
}: {
  phase: PhaseKey;
  checked: boolean;
  artifactVariant: ArtifactVariantKey;
  selectingArtifact: boolean;
  onCheck: () => void;
  onOpenSource: () => void;
  onShuffleArtifact: () => void;
}) {
  if (phase === "parse") return <ParseScene />;
  if (phase === "context") return <ContextScene />;
  if (phase === "select") return <SelectScene />;
  if (phase === "artifact") {
    return (
      <ArtifactScene
        checked={checked}
        selected={artifactVariant}
        selecting={selectingArtifact}
        onCheck={onCheck}
        onOpenSource={onOpenSource}
        onShuffle={onShuffleArtifact}
      />
    );
  }
  return <RevisionScene checked={checked} />;
}

function ParseScene() {
  const parseStages = [
    { label: "校验授权与文件", key: "VALIDATING" },
    { label: "语音转写", key: "TRANSCRIBING" },
    { label: "视频内容理解", key: "UNDERSTANDING" },
    { label: "自动两级分类", key: "CLASSIFYING" },
  ];
  const categories = [
    { title: "海边人像", count: 2, tone: "coral" },
    { title: "手机摄影", count: 2, tone: "sage" },
    { title: "室内弱光", count: 2, tone: "neutral" },
  ];

  return (
    <div className="parse-scene">
      <div className="parse-source">
        <SceneLead number="00" eyebrow="Async collection intelligence" title="收藏进入后台，AI 自动理解与分类" detail="无需先手工整理；解析完成后，分类与内容理解会成为后续目标的隐形上下文。" />
        <div className="folded-collection">
          <div className="folded-shadow shadow-three"><span>+ 其他收藏视频</span></div>
          <div className="folded-shadow shadow-two"><span>更多摄影教程</span></div>
          <div className="folded-shadow shadow-one"><span>已授权收藏</span></div>
          <div className="parse-video-row">
            {VIDEOS.slice(0, 3).map((video, index) => (
              <article key={video.id} style={{ "--parse-video-delay": `${index * 110}ms` } as CSSProperties}>
                <div><Image alt={`正在解析：${video.title}`} fill priority sizes="100px" src={video.image} /><i /></div>
                <p><b>{video.title}</b><small>{index === 0 ? "理解画面与动作" : index === 1 ? "提取拍摄技巧" : "识别适用场景"}</small></p>
              </article>
            ))}
          </div>
        </div>
        <p className="parse-boundary"><i /> 本地授权导入 · 后台运行 · 可离开页面</p>
      </div>

      <div className="parse-job">
        <header><span><i /></span><p><small>BACKGROUND JOB</small><b>解析收藏内容</b></p><em>SSE</em></header>
        <div className="parse-stage-list">
          {parseStages.map((stage, index) => (
            <div key={stage.key} style={{ "--parse-stage-delay": `${450 + index * 680}ms` } as CSSProperties}>
              <span>{index + 1}</span><p><b>{stage.label}</b><small>{stage.key}</small></p><i>✓</i>
            </div>
          ))}
        </div>
        <footer><span><i /></span><p><b>READY</b><small>理解包与分类已保存</small></p><em>100%</em></footer>
      </div>

      <div className="category-result">
        <header><small>AUTO CLASSIFICATION</small><b>摄影教程</b><span>一级分类</span></header>
        <div className="category-trunk"><i /><span /></div>
        <div className="category-branches">
          {categories.map((category, index) => (
            <article className={category.tone} key={category.title} style={{ "--category-delay": `${2450 + index * 260}ms` } as CSSProperties}>
              <span>{String(index + 1).padStart(2, "0")}</span><p><b>{category.title}</b><small>二级分类 · {category.count} 条</small></p><i>→</i>
            </article>
          ))}
        </div>
        <p><i /> 自动完成，无需用户先整理收藏夹</p>
      </div>
    </div>
  );
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

function ArtifactScene({
  checked,
  selected,
  selecting,
  onCheck,
  onOpenSource,
  onShuffle,
}: {
  checked: boolean;
  selected: ArtifactVariantKey;
  selecting: boolean;
  onCheck: () => void;
  onOpenSource: () => void;
  onShuffle: () => void;
}) {
  return (
    <div className="artifact-scene-v2">
      <div className="compiler-lane">
        <SceneLead number="03" eyebrow="Artifact compiler" title="同一份收藏，编译成最合适的成果" detail="目标不同，Artifact 的形态也会随之改变。" />
        <div className="compiler-stack">
          {["锁定收藏范围", "编译现场顺序", "校验关键来源"].map((item, index) => <div key={item} style={{ "--pass-delay": `${index * 260}ms` } as CSSProperties}><span>{index + 1}</span><p>{item}</p><i>完成</i></div>)}
        </div>
        <div className={`artifact-picker ${selecting ? "selecting" : ""}`}>
          <header><span>{selecting ? "正在匹配成果形态…" : "已选择成果形态"}</span><button onClick={onShuffle} type="button">换一种 ↻</button></header>
          <div>
            {ARTIFACT_VARIANTS.map((variant) => (
              <span className={variant.key === selected ? "active" : ""} key={variant.key}><i />{variant.label}</span>
            ))}
          </div>
        </div>
        <div className="compiler-status"><span><i /></span><p><b>Collection Artifact Compiler</b><small>统一来源关系 · 多种结构化输出</small></p><em>{selecting ? "MATCHING" : "READY"}</em></div>
      </div>

      <div className={`artifact-output ${selecting ? "is-selecting" : ""}`} key={selected}>
        <ArtifactVariant selected={selected} checked={checked} onCheck={onCheck} onOpenSource={onOpenSource} />
      </div>
    </div>
  );
}

function ArtifactVariant({
  selected,
  checked,
  onCheck,
  onOpenSource,
}: {
  selected: ArtifactVariantKey;
  checked: boolean;
  onCheck: () => void;
  onOpenSource: () => void;
}) {
  if (selected === "task") return <TaskCard checked={checked} onCheck={onCheck} onOpenSource={onOpenSource} />;
  if (selected === "compact") return <CompactArtifact onOpenSource={onOpenSource} />;
  if (selected === "compare") return <ComparisonArtifact onOpenSource={onOpenSource} />;
  return <StoryboardArtifact onOpenSource={onOpenSource} />;
}

function TaskCard({ checked, onCheck, onOpenSource }: { checked: boolean; onCheck: () => void; onOpenSource: () => void }) {
  const sections = [
    { title: "拍摄前", items: ["清洁镜头并释放手机存储", "确认晴天白天与可拍区域"] },
    { title: "到场后", items: ["先让朋友自然走动，不急着看镜头", "强光时锁定面部，再微调曝光"] },
    { title: "拍完后", items: ["放大检查眼睛是否清晰", "保留动作自然的备选照片"] },
  ];
  return (
    <article className="task-card-v2">
      <header><div><small>SHOOTING TASK CARD · 当前主演示</small><h3>晴天海边自然互动人像</h3><p>现场可以直接照着完成的任务卡</p></div><span>8 项<br />3 阶段</span></header>
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

function CompactArtifact({ onOpenSource }: { onOpenSource: () => void }) {
  const lines = ["镜头擦净，留足存储", "先走动互动，再看镜头", "锁脸后轻微降曝光", "拍完放大检查眼睛", "保留自然动作备选"];
  return (
    <article className="artifact-card-v2 compact-artifact">
      <ArtifactHeader eyebrow="POCKET NOTE · 演示形态" title="海边人像 · 一屏小纸条" detail="把现场动作压缩成抬手就能扫完的五行提醒" meta="5 行" />
      <ol>{lines.map((line, index) => <li key={line}><i>{index + 1}</i><span>{line}</span><b>{index === 2 ? "VIDEO" : "✓"}</b></li>)}</ol>
      <footer><span>来源关系与任务状态保持不变</span><button onClick={onOpenSource} type="button">查看依据 →</button></footer>
    </article>
  );
}

function ComparisonArtifact({ onOpenSource }: { onOpenSource: () => void }) {
  const options = [
    { title: "边走边聊", note: "互动自然，动作容易连续完成", natural: 92, stable: 88, image: "/demo/video-seaside.jpg" },
    { title: "逆光剪影", note: "氛围突出，但手机曝光容错较低", natural: 78, stable: 62, image: "/demo/video-seaside-detail.jpg" },
    { title: "静态看镜头", note: "画面稳定，但与自然互动目标较弱", natural: 61, stable: 91, image: "/demo/video-lotus-detail.jpg" },
  ];
  return (
    <article className="artifact-card-v2 comparison-artifact">
      <ArtifactHeader eyebrow="DECISION TABLE · 概念扩展演绎" title="逐条评估，再选择最优解" detail="同一时间只看一个方案，最后给出清晰结论" meta="3 → 1" />
      <div className="decision-reel">
        <div className="decision-reel-top">
          <span><i /> AI 正在逐条评估</span>
          <div>{options.map((option, index) => <i key={option.title} style={{ "--decision-dot-delay": `${index * 850}ms` } as CSSProperties}>{index + 1}</i>)}</div>
        </div>
        <div className="decision-stage">
        {options.map((option, index) => (
            <section className="decision-candidate" key={option.title} style={{ "--candidate-delay": `${120 + index * 850}ms` } as CSSProperties}>
              <div className="candidate-image"><Image alt="" fill sizes="260px" src={option.image} /><span>方案 {String.fromCharCode(65 + index)}</span></div>
              <div className="candidate-copy">
                <small>EVALUATING · {String(index + 1).padStart(2, "0")} / 03</small>
                <h4>{option.title}</h4><p>{option.note}</p>
                <div className="candidate-metric"><span>自然互动</span><i><b style={{ width: `${option.natural}%` }} /></i><em>{option.natural}</em></div>
                <div className="candidate-metric"><span>现场稳定</span><i><b style={{ width: `${option.stable}%` }} /></i><em>{option.stable}</em></div>
              </div>
            </section>
          ))}
          <section className="decision-winner">
            <div className="winner-image"><Image alt="" fill sizes="260px" src={options[0].image} /><span>最优解</span></div>
            <div className="winner-copy">
              <small>AI RECOMMENDATION</small><h4>边走边聊</h4>
              <p>最符合“自然互动人像”，同时兼顾手机拍摄的现场稳定性。</p>
              <div><span>自然互动 92</span><span>现场稳定 88</span><span>操作难度低</span></div>
              <b><i>✓</i> 已选为执行方案</b>
            </div>
          </section>
        </div>
        <p className="decision-reason"><span>选择依据</span>目标匹配度 × 收藏证据 × 现场可执行性</p>
      </div>
      <footer><span>逐条评估 3 个方案 · 最终保留 1 个最优解</span><button onClick={onOpenSource} type="button">打开选择依据 →</button></footer>
    </article>
  );
}

function StoryboardArtifact({ onOpenSource }: { onOpenSource: () => void }) {
  const shots = [
    { title: "建立环境", action: "人物从远处走入画面", time: "3s", image: "/demo/video-seaside.jpg" },
    { title: "自然互动", action: "边走边聊，不看镜头", time: "5s", image: "/demo/video-seaside-detail.jpg" },
    { title: "动作特写", action: "手部递物，保留海面", time: "3s", image: "/demo/video-lotus-detail.jpg" },
    { title: "回头收尾", action: "走过镜头后自然回头", time: "4s", image: "/demo/video-lotus.jpg" },
  ];
  return (
    <article className="artifact-card-v2 storyboard-artifact">
      <ArtifactHeader eyebrow="SHOT LIST · 概念扩展演绎" title="海边互动 · 四镜分镜" detail="把教程动作编排成可以逐镜执行的拍摄脚本" meta="4 镜" />
      <div className="storyboard-grid">
        {shots.map((shot, index) => (
          <section key={shot.title}>
            <div><Image alt="" fill sizes="140px" src={shot.image} /><span>{shot.time}</span></div>
            <small>SHOT {String(index + 1).padStart(2, "0")}</small><h4>{shot.title}</h4><p>{shot.action}</p>
          </section>
        ))}
      </div>
      <footer><span>顺序由 AI 综合，动作来自授权收藏</span><button onClick={onOpenSource} type="button">查看镜头来源 →</button></footer>
    </article>
  );
}

function ArtifactHeader({ eyebrow, title, detail, meta }: { eyebrow: string; title: string; detail: string; meta: string }) {
  return <header className="artifact-card-header"><div><small>{eyebrow}</small><h3>{title}</h3><p>{detail}</p></div><span>{meta}</span></header>;
}

function RevisionScene({ checked }: { checked: boolean }) {
  const lines = ["镜头擦净，留足存储", "先走动互动，再看镜头", "锁脸后轻微降曝光", "拍完放大检查眼睛", "保留自然动作备选"];
  return (
    <div className="revision-scene-v2">
      <div className="provenance-panel">
        <SceneLead number="04" eyebrow="Provenance" title="形态持续变化，来源关系始终保留" detail="Video、Web 与 AI 综合有清晰边界。" />
        <div className="focus-action"><small>任务卡 · 到场后</small><b>强光时锁定面部，再微调曝光</b><span>3 条依据</span></div>
        <div className="source-list-v2">
          <SourceEntry kind="VIDEO" title="晴天手机人像" detail="01:18—01:31 · 面部对焦与曝光" image="/demo/video-seaside-detail.jpg" />
          <SourceEntry kind="VIDEO" title="海边自然互动" detail="00:42—00:56 · 锁定主体后微调" image="/demo/video-seaside.jpg" />
          <SourceEntry kind="INFERENCE" title="行动顺序由 AI 综合" detail="不伪造链接或创作者原话" />
        </div>
        <p className="web-status"><span>WEB</span><b>本次未联网</b><small>当前目标不需要动态事实</small></p>
      </div>

      <div className="revision-panel">
        <div className="iteration-heading">
          <div><small>CONTINUOUS ARTIFACT</small><b>一句话，让同一成果持续进化</b></div>
          <span>展示形态演绎</span>
        </div>

        <div className="iteration-command-stage" aria-label="连续修改指令">
          <div className="iteration-command command-compact"><span>你</span><p>压缩成一屏小纸条</p><i>v2</i></div>
          <div className="iteration-command command-compare"><span>你</span><p>把三种拍法整理成决策对比</p><i>v3</i></div>
          <div className="iteration-command command-story"><span>你</span><p>按四个镜头重新编排</p><i>v4</i></div>
        </div>

        <div className="iteration-version-line" aria-label="Artifact 版本演进">
          {[
            ["v1", "任务卡"],
            ["v2", "小纸条"],
            ["v3", "决策表"],
            ["v4", "四镜分镜"],
          ].map(([version, label], index) => (
            <div className={`version-node node-${index + 1}`} key={version}><span>{version}</span><small>{label}</small>{index < 3 ? <i>→</i> : null}</div>
          ))}
        </div>

        <div className="iteration-canvas">
          <article className="iteration-view iteration-compact">
            <header><div><small>COMPACT VARIANT · v2 · 当前可用</small><h3>海边人像 · 一屏小纸条</h3></div><span>5 行</span></header>
            <ol>{lines.map((line, index) => <li key={line}><i>{index + 1}</i><span>{line}</span>{checked && index === 3 ? <b>✓</b> : null}</li>)}</ol>
          </article>

          <article className="iteration-view iteration-compare">
            <header><div><small>DECISION VIEW · v3 · 概念扩展演绎</small><h3>三种拍法，留下一个最优解</h3></div><span>3 → 1</span></header>
            <div className="mini-decision-list">
              <p className="selected"><i>A</i><span><b>边走边聊</b><small>自然互动 92 · 现场稳定 88</small></span><em>最优</em></p>
              <p><i>B</i><span><b>逆光剪影</b><small>氛围突出 · 曝光容错低</small></span><em>备选</em></p>
              <p><i>C</i><span><b>静态看镜头</b><small>画面稳定 · 互动感较弱</small></span><em>保底</em></p>
            </div>
          </article>

          <article className="iteration-view iteration-story">
            <header><div><small>SHOT LIST · v4 · 概念扩展演绎</small><h3>海边互动 · 四镜分镜</h3></div><span>4 镜</span></header>
            <div className="mini-story-grid">
              {[
                ["01", "建立环境", "/demo/video-seaside.jpg"],
                ["02", "自然互动", "/demo/video-seaside-detail.jpg"],
                ["03", "动作特写", "/demo/video-lotus-detail.jpg"],
                ["04", "回头收尾", "/demo/video-lotus.jpg"],
              ].map(([number, title, image]) => (
                <section key={number}><div><Image alt="" fill sizes="100px" src={image} /><span>{number}</span></div><b>{title}</b></section>
              ))}
            </div>
          </article>
        </div>

        <div className="iteration-invariants">
          <span><i>✓</i> Artifact ID 保持不变</span>
          <span><i>✓</i> 来源关系保留</span>
          <span><i>✓</i> {checked ? "勾选状态已保留" : "可继续一句话修改"}</span>
        </div>
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
