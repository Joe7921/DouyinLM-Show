"use client";

import { useEffect, useMemo, useState } from "react";

const PHASES = [
  { key: "goal", label: "目标", duration: 3200 },
  { key: "select", label: "选片", duration: 3600 },
  { key: "clarify", label: "追问", duration: 3600 },
  { key: "compile", label: "编译", duration: 4000 },
  { key: "artifact", label: "任务卡", duration: 4400 },
  { key: "source", label: "来源", duration: 3800 },
  { key: "revise", label: "修改", duration: 4400 },
] as const;

const STAGE_COPY = [
  "目标直接继承全部收藏，无需建项目",
  "采用与排除都保留短理由",
  "只补问一个会改变结果的条件",
  "按现场顺序编译并校验来源",
  "任务卡可以勾选，勾选不改版本",
  "Video / Web / Inference 边界可检查",
  "同一 Artifact 一句话修改到 v2",
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
    <section className="interactive-demo" id="demo" aria-label="douyinLM 产品运行交互演绎">
      <header className="demo-topbar">
        <div className="demo-identity">
          <span className="window-logo">dL</span>
          <div><b>Collection Artifact Compiler</b><small>收藏内容 → 可执行成果</small></div>
        </div>
        <span className="simulation-label"><i /> 流程模拟 · 非实时 AI</span>
      </header>

      <div className="phase-rail" role="tablist" aria-label="演示阶段">
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
            <span>{index < phaseIndex ? "✓" : index + 1}</span><small>{item.label}</small>
          </button>
        ))}
        <div className="rail-line" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
      </div>

      <div className="demo-viewport" aria-live="polite">
        <div className={`demo-scene scene-${phase.key}`} key={`${phase.key}-${cycle}`}>
          <Scene phase={phase.key} checked={checked} onCheck={() => setChecked((value) => !value)} onOpenSource={() => goTo(5)} />
        </div>
      </div>

      <footer className="demo-controls">
        <div className="stage-caption"><span>{String(phaseIndex + 1).padStart(2, "0")} / 07</span><p>{STAGE_COPY[phaseIndex]}</p></div>
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
  if (phase === "goal") return <GoalScene />;
  if (phase === "select") return <SelectScene />;
  if (phase === "clarify") return <ClarifyScene />;
  if (phase === "compile") return <CompileScene />;
  if (phase === "artifact") return <ArtifactScene checked={checked} onCheck={onCheck} onOpenSource={onOpenSource} />;
  if (phase === "source") return <SourceScene />;
  return <RevisionScene checked={checked} />;
}

function GoalScene() {
  return (
    <div className="goal-scene">
      <div className="collection-context"><span>授权收藏</span><b>6 条摄影教程</b><small>AI 类目已形成 · 无需手动整理</small></div>
      <div className="goal-composer">
        <small>这次你想完成什么？</small>
        <p className="typed-goal">我准备去海边给朋友拍自然互动人像，帮我生成一张现场拍摄任务卡。</p>
        <div><span>范围 · 全部收藏</span><b>开始 Vibe <i>→</i></b></div>
      </div>
      <p className="scene-note"><i /> 第一条输入自动创建并保存工作区</p>
    </div>
  );
}

function SelectScene() {
  const adopted = ["手机构图与对焦", "海边自然互动", "晴天人像曝光"];
  const excluded = ["设备条件不符", "光线场景不符", "只提供灵感，缺少行动步骤"];
  return (
    <div className="select-scene">
      <SceneHeading eyebrow="Scope resolver" title="从 6 条候选中，选择真正改变结果的内容" />
      <div className="selection-columns">
        <div className="selection-column adopted"><header><span>采用</span><b>3</b></header>{adopted.map((item, index) => <div className="selection-row" style={{ animationDelay: `${index * 120}ms` }} key={item}><i>✓</i><p><b>{item}</b><small>直接支持现场任务</small></p></div>)}</div>
        <div className="selection-column excluded"><header><span>排除</span><b>3</b></header>{excluded.map((item, index) => <div className="selection-row" style={{ animationDelay: `${index * 120 + 80}ms` }} key={item}><i>×</i><p><b>{item}</b><small>保留排除理由</small></p></div>)}</div>
      </div>
      <p className="scene-note"><i /> 范围没有被静默扩大 · Web 尚未调用</p>
    </div>
  );
}

function ClarifyScene() {
  return (
    <div className="clarify-scene">
      <SceneHeading eyebrow="Gap classifier" title="只问一个会显著改变任务卡的问题" />
      <div className="conversation">
        <div className="assistant-bubble"><span>AI</span><p>你会使用手机还是相机？这会改变对焦方式和参数建议。</p></div>
        <div className="user-bubble"><p>手机，晴天白天。</p><span>关键约束已确认</span></div>
      </div>
      <div className="clarify-result"><span>1 / 1</span><p><b>追问结束</b><small>信息已经足够，继续编译成果</small></p><i>→</i></div>
    </div>
  );
}

function CompileScene() {
  const rows = [
    ["锁定范围", "6 条候选 · 未越界"],
    ["选择来源", "采用 3 · 排除 3"],
    ["确认缺口", "手机 · 晴天白天"],
    ["编译任务卡", "拍摄前 → 到场后 → 拍完后"],
    ["校验来源", "关键行动必须有依据"],
  ];
  return (
    <div className="compile-scene">
      <SceneHeading eyebrow="Agent execution" title="正在把收藏证据编译成行动成果" />
      <div className="execution-log">{rows.map(([title, detail], index) => <div className="execution-row" style={{ animationDelay: `${index * 360}ms` }} key={title}><span>{index + 1}</span><p><b>{title}</b><small>{detail}</small></p><i>完成</i></div>)}</div>
      <div className="compile-status"><span><i /></span><p><b>Collection Artifact Compiler</b><small>结构化输出 + Provenance Validator</small></p><em>运行中</em></div>
    </div>
  );
}

function ArtifactScene({ checked, onCheck, onOpenSource }: { checked: boolean; onCheck: () => void; onOpenSource: () => void }) {
  return (
    <div className="artifact-scene">
      <div className="artifact-heading"><div><small>SHOOTING TASK CARD · v1</small><h3>晴天海边自然互动人像</h3></div><span>8 项 · 3 阶段</span></div>
      <div className="artifact-sections">
        <MiniSection title="拍摄前" items={["清洁手机镜头并释放存储", "确认晴天白天与可拍区域"]} />
        <MiniSection title="到场后" items={["先让朋友自然走动，不急着看镜头", "强光时锁定面部，再微调曝光"]} sourceAction={onOpenSource} />
        <MiniSection title="拍完后" items={["放大检查眼睛是否清晰", "保留动作自然的备选照片"]} checked={checked} onCheck={onCheck} />
      </div>
      <div className="artifact-footer"><button onClick={onCheck} type="button"><i className={checked ? "checked" : ""}>{checked ? "✓" : ""}</i>{checked ? "已完成一项" : "试着勾选一项"}</button><button onClick={onOpenSource} type="button">查看来源 <span>→</span></button></div>
    </div>
  );
}

function MiniSection({ title, items, sourceAction, checked, onCheck }: { title: string; items: string[]; sourceAction?: () => void; checked?: boolean; onCheck?: () => void }) {
  return (
    <section className="mini-section"><header><span>{title}</span><small>{items.length} 项</small></header>{items.map((item, index) => <div className={`artifact-item ${checked && index === 1 ? "done" : ""}`} key={item}><button aria-label={`勾选：${item}`} onClick={index === 1 && onCheck ? onCheck : undefined} type="button">{checked && index === 1 ? "✓" : ""}</button><p>{item}</p>{index === 1 && sourceAction ? <button className="source-chip" onClick={sourceAction} type="button">VIDEO · 01:18</button> : <span className="source-chip">VIDEO</span>}</div>)}</section>
  );
}

function SourceScene() {
  return (
    <div className="source-scene">
      <div className="source-canvas"><small>任务卡 · 到场后</small><h3>强光时锁定面部，再微调曝光</h3><p>这个行动项引用了两段授权视频证据，并明确标记整理顺序来自 AI 综合。</p><span>provenance_ids · 3</span></div>
      <aside className="source-drawer">
        <header><div><small>Provenance</small><b>依据与边界</b></div><span>3 条</span></header>
        <div className="source-entry video"><i>VIDEO</i><p><b>授权视频 02 · 晴天手机人像</b><small>01:18—01:31 · 面部对焦与曝光调整</small></p></div>
        <div className="source-entry video"><i>VIDEO</i><p><b>授权视频 05 · 手机对焦操作</b><small>00:42—00:56 · 锁定主体后再微调亮度</small></p></div>
        <div className="source-entry inference"><i>INFERENCE</i><p><b>行动顺序由 AI 综合</b><small>不伪造外部链接，不冒充创作者原话</small></p></div>
        <div className="web-off"><span>WEB</span><p><b>本次未联网</b><small>当前目标不需要天气或场地的动态事实</small></p></div>
      </aside>
    </div>
  );
}

function RevisionScene({ checked }: { checked: boolean }) {
  const lines = ["镜头擦净，留足存储", "先走动互动，再看镜头", "锁脸后轻微降曝光", "拍完放大检查眼睛", "保留自然动作备选"];
  return (
    <div className="revision-scene">
      <div className="revision-command"><span>你</span><p>压缩成一屏小纸条</p><i>已发送</i></div>
      <div className="version-shift"><span>v1</span><i>→</i><span className="active">v2</span><p>Artifact ID 保持不变</p></div>
      <article className="compact-card"><header><div><small>COMPACT VARIANT · v2</small><h3>海边人像 · 一屏小纸条</h3></div><span>5 行</span></header><ol>{lines.map((line, index) => <li key={line}><i>{index + 1}</i><span>{line}</span>{checked && index === 3 ? <b>✓</b> : null}</li>)}</ol><footer><span>来源关系已保留</span><b>{checked ? "勾选状态已保留" : "可继续勾选"}</b></footer></article>
      <p className="scene-note success-note"><i /> 同一成果持续 Vibe，而不是重新生成第二份文档</p>
    </div>
  );
}

function SceneHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <div className="scene-heading"><span>{eyebrow}</span><h3>{title}</h3></div>;
}
