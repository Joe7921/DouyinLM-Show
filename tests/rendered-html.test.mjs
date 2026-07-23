import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("interactive demo covers the complete judge loop honestly", async () => {
  const [demo, page] = await Promise.all([
    readFile(new URL("app/ProductDemo.tsx", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
  ]);

  for (const stage of ["parse", "context", "select", "artifact", "revise"]) {
    assert.match(demo, new RegExp(`key: "${stage}"`));
  }
  assert.match(demo, /流程模拟 · 非实时 AI/);
  assert.match(demo, /BACKGROUND JOB/);
  assert.match(demo, /TRANSCRIBING/);
  assert.match(demo, /UNDERSTANDING/);
  assert.match(demo, /自动两级分类/);
  assert.match(demo, /\+ 其他收藏视频/);
  assert.match(demo, /采用 3 · 排除 3/);
  assert.match(demo, /唯一一次追问/);
  assert.match(demo, /SHOOTING TASK CARD/);
  for (const artifact of ["现场任务卡", "一屏小纸条", "对比决策表", "四镜分镜"]) {
    assert.match(demo, new RegExp(artifact));
  }
  assert.match(demo, /crypto\.getRandomValues/);
  assert.match(demo, /概念扩展演绎/);
  assert.match(demo, /VIDEO/);
  assert.match(demo, /INFERENCE/);
  assert.match(demo, /Artifact ID 保持不变/);
  assert.match(demo, /本次未联网/);
  assert.match(page, /不把模拟过程冒充实时模型结果/);
});

test("motion respects accessibility preferences", async () => {
  const [demo, motion, css] = await Promise.all([
    readFile(new URL("app/ProductDemo.tsx", root), "utf8"),
    readFile(new URL("app/MotionObserver.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);
  assert.match(demo, /prefers-reduced-motion: reduce/);
  assert.match(motion, /IntersectionObserver/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
