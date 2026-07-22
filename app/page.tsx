import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "douyinLM｜在收藏夹中 VibeCoding",
  description: "把收藏的视频，编译成可以直接行动的成果。",
};

const productUrl = process.env.NEXT_PUBLIC_PRODUCT_URL?.trim() || "#demo";

const steps = [
  ["01", "说出目标", "不用整理收藏夹，只要描述这次真正想完成的事。"],
  ["02", "AI 选择", "从授权收藏中采用相关视频，也解释为什么排除其他内容。"],
  ["03", "一次追问", "只在答案会明显改变结果时，补问一个关键问题。"],
  ["04", "生成任务卡", "把视频知识编译成到现场就能勾选执行的步骤。"],
  ["05", "查看与修改", "每一步都能看来源，并用一句话继续修改成果。"],
] as const;

export default function Home() {
  return (
    <main>
      <nav className="nav shell" aria-label="主导航">
        <a className="brand" href="#top" aria-label="douyinLM 首页"><span className="brand-mark">dL</span><span>douyinLM</span></a>
        <a className="nav-link" href="#how">工作方式</a>
        <a className="nav-cta" href={productUrl}>进入产品</a>
      </nav>

      <section className="hero shell" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span /> 抖音精选 · 内容重构</p>
          <h1>收藏不再是终点，<br /><em>而是行动的上下文。</em></h1>
          <p className="lede">douyinLM 理解你收藏的摄影教程。你只需说出目标，AI 就会选择真正相关的视频，把零散知识编译成一张可以直接执行、查看来源、继续修改的任务卡。</p>
          <div className="hero-actions">
            <a className="button primary" href={productUrl}>查看核心体验 <span>→</span></a>
            <a className="button secondary" href="#how">了解它如何工作</a>
          </div>
          <p className="availability">当前为产品演示页 · 正式体验入口将由上方按钮接入</p>
        </div>

        <div className="product-window" id="demo" aria-label="douyinLM 产品流程示意">
          <div className="window-bar"><span className="window-logo">dL</span><div><b>现场拍摄助手</b><small>来自我的摄影收藏</small></div><span className="demo-label">流程示意</span></div>
          <div className="goal-card"><small>这次你想完成什么？</small><p>帮我拍一组有电影感的夜景人像，现场能照着做。</p><div className="goal-footer"><span>已读取 12 条授权收藏</span><b>生成任务卡</b></div></div>
          <div className="ai-row"><span className="spark">AI</span><div><b>已采用 3 条相关视频</b><small>排除 9 条，并保留选择理由</small></div><span className="success">已完成</span></div>
          <article className="task-card">
            <header><div><small>现场任务卡 · v1</small><h2>电影感夜景人像</h2></div><span>5 项</span></header>
            <ul>
              <li><i className="checked">✓</i><span><b>到场前：找一处侧后方有霓虹灯的街角</b><small>来源：视频 02 · 01:18</small></span></li>
              <li><i>2</i><span><b>让人物离背景灯牌 3—5 米</b><small>来源：视频 07 · 00:42</small></span></li>
              <li><i>3</i><span><b>先锁定眼睛，再降低曝光补偿</b><small>来源：视频 11 · 02:06</small></span></li>
            </ul>
            <footer><span>“压缩成一屏能看完的小纸条”</span><b>一句话修改 →</b></footer>
          </article>
        </div>
      </section>

      <section className="promise shell" aria-label="产品价值"><p>不是视频总结器</p><span>×</span><p>不是收藏夹管理器</p><span>×</span><p className="promise-focus">是把收藏转化为行动成果的 AI 编译器</p></section>

      <section className="how shell" id="how">
        <div className="section-heading"><p className="eyebrow"><span /> 从收藏到行动</p><h2>不用重看一遍，<br />直接带走能执行的结果。</h2><p>收藏天然成为上下文，用户无需复制链接、手动分类或重新建立项目。</p></div>
        <div className="steps">{steps.map(([number, title, description]) => <article className="step" key={number}><span>{number}</span><h3>{title}</h3><p>{description}</p></article>)}</div>
      </section>

      <section className="trust shell">
        <div><p className="eyebrow light"><span /> 可信任的 AI 成果</p><h2>每一个行动建议，<br />都知道它从哪里来。</h2></div>
        <div className="trust-grid"><div><span>VIDEO</span><b>真实视频来源</b><p>定位到具体视频和时间点。</p></div><div><span>WEB</span><b>必要的动态补充</b><p>只在信息缺口确实存在时检索。</p></div><div><span>INFERENCE</span><b>明确标记推断</b><p>不把 AI 判断伪装成外部事实。</p></div></div>
      </section>

      <section className="final-cta shell"><p>在收藏夹中 VibeCoding</p><h2>让看过的内容，<br />真正帮你完成下一件事。</h2><a className="button primary" href={productUrl}>进入 douyinLM <span>→</span></a></section>
      <footer className="footer shell"><span>douyinLM · 抖音精选内容重构赛道</span><span>产品演示页</span></footer>
    </main>
  );
}
