import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { MotionObserver } from "./MotionObserver";
import { ProductDemo } from "./ProductDemo";

export const metadata: Metadata = {
  title: "douyinLM｜在收藏夹中 VibeCoding",
  description: "把收藏的视频，编译成可以直接行动的成果。",
};

const productUrl = process.env.NEXT_PUBLIC_PRODUCT_URL?.trim() || "#demo";

const steps = [
  ["01", "说出目标", "不整理收藏夹，只描述这次真正想完成的事。"],
  ["02", "AI 选择", "从授权收藏中采用相关视频，并解释排除理由。"],
  ["03", "一次追问", "只在答案会明显改变结果时，补问一个条件。"],
  ["04", "编译任务卡", "按拍摄前、到场后、拍完后的顺序组织行动。"],
  ["05", "查看与修改", "打开来源、勾选行动，再用一句话持续修改。"],
] as const;

export default function Home() {
  return (
    <main>
      <MotionObserver />
      <nav className="nav shell" aria-label="主导航">
        <a className="brand" href="#top" aria-label="douyinLM 首页"><span className="brand-mark">dL</span><span>douyinLM</span></a>
        <div className="nav-center"><a href="#how">工作方式</a><a href="#trust">可信来源</a></div>
        <a className="nav-cta" href={productUrl}>进入产品 <span>↗</span></a>
      </nav>

      <section className="hero shell" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span /> 抖音精选 · 内容重构</p>
          <h1>收藏不再是终点，<br /><em>而是行动的上下文。</em></h1>
          <p className="lede">douyinLM 理解你收藏的摄影教程。你只需说出目标，AI 就会选择真正相关的视频，把零散知识编译成一张可以执行、查看依据、继续修改的任务卡。</p>
          <div className="hero-actions"><a className="button primary" href="#demo">播放完整演绎 <span>↓</span></a><a className="button secondary" href="#how">了解工作方式</a></div>
          <p className="availability"><i /> 互动演绎使用流程模拟数据，不代表正在调用实时 AI</p>
        </div>
        <div className="hero-demo"><div className="ambient-orbit orbit-one" /><div className="ambient-orbit orbit-two" /><ProductDemo /></div>
      </section>

      <section className="promise shell" data-reveal aria-label="产品价值"><p>不是视频总结器</p><span>×</span><p>不是收藏夹管理器</p><span>→</span><p className="promise-focus">是把收藏转化为行动成果的 AI 编译器</p></section>

      <section className="how shell" id="how">
        <div className="section-heading" data-reveal><p className="eyebrow"><span /> 从收藏到行动</p><h2>不用重看一遍，<br />直接带走能执行的结果。</h2><p>收藏天然成为上下文。用户无需复制链接、手动分类或重新建立项目。</p></div>
        <div className="steps">{steps.map(([number, title, description], index) => <article className="step" data-reveal style={{ "--reveal-delay": `${index * 70}ms` } as CSSProperties} key={number}><span>{number}</span><h3>{title}</h3><p>{description}</p></article>)}</div>
      </section>

      <section className="truth-note shell" data-reveal>
        <span>产品边界</span><p>比赛体验从经许可、已预处理的真实收藏视频开始；网页中的动画负责解释产品运行方式，不把模拟过程冒充实时模型结果。</p>
      </section>

      <section className="trust shell" id="trust" data-reveal>
        <div><p className="eyebrow light"><span /> 可信任的 AI 成果</p><h2>关键行动建议，<br />必须知道它从哪里来。</h2><p className="trust-copy">来源不是装饰，而是任务卡能否被相信和执行的组成部分。</p></div>
        <div className="trust-grid"><div><span>VIDEO</span><b>真实视频来源</b><p>定位到具体视频和时间点。</p></div><div><span>WEB</span><b>必要时才联网</b><p>动态事实显示网址与检索时间。</p></div><div><span>INFERENCE</span><b>明确标记 AI 综合</b><p>不伪造外部链接或创作者原话。</p></div></div>
      </section>

      <section className="final-cta shell" data-reveal><p>在收藏夹中 VibeCoding</p><h2>让看过的内容，<br />真正帮你完成下一件事。</h2><a className="button primary" href={productUrl}>进入 douyinLM <span>↗</span></a></section>
      <footer className="footer shell"><span>douyinLM · 抖音精选内容重构赛道</span><span>产品演示页 · UTC+8</span></footer>
    </main>
  );
}
