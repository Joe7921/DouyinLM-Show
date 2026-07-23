import assert from "node:assert/strict";
import test from "node:test";

import {
  auditEvaluationEvidence,
  auditGoldenLabels,
  auditUserResults,
  parseCsv,
} from "./audit-evaluation.mjs";

function goldenDocument({ uncertain = false } = {}) {
  return {
    schema_version: "1.0",
    status: "human_review_complete",
    collection_fingerprint: "a".repeat(64),
    scenarios: [
      {
        scenario_id: "beach-photo-v1",
        goal: "在晴天海边为朋友拍自然互动人像",
        launch_scope: { mode: "home", category_id: null, video_ids: [] },
        constraints: ["手机"],
        annotated_by: "A01",
        annotated_at: "2026-07-23T10:00:00+08:00",
        workspace_id: "workspace-1",
        run_id: "run-1",
        candidates: [
          {
            source_hash: "b".repeat(64),
            filename: "video-1.mp4",
            title: "海边人像构图",
            author: "授权作者",
            source_url: "https://www.douyin.com/video/1",
            expected_decision: uncertain ? "uncertain" : "adopt",
            reason: "包含直接支持现场构图的步骤",
            evidence_ranges: [{ start_ms: 1000, end_ms: 5000, summary: "人物放在右下四格" }],
            reviewed_by: uncertain ? null : "A02",
            resolved_decision: uncertain ? null : "adopt",
          },
          {
            source_hash: "c".repeat(64),
            filename: "video-2.mp4",
            title: "室内静物布光",
            author: "授权作者",
            source_url: "https://www.douyin.com/video/2",
            expected_decision: "exclude",
            reason: "与海边人像目标不直接相关",
            evidence_ranges: [{ start_ms: 2000, end_ms: 6000, summary: "只讲室内静物灯位" }],
            reviewed_by: null,
            resolved_decision: null,
          },
        ],
      },
    ],
  };
}

function csvEvidence({ slow = false } = {}) {
  const header = "participant_id,consent_recorded,test_order,scenario_id,observed_at,baseline_seconds,baseline_video_replays,baseline_completed_steps,baseline_total_steps,douyinlm_seconds,douyinlm_source_opens,douyinlm_completed_steps,douyinlm_total_steps,selection_matches,selection_labels,revision_requested,revision_succeeded,key_action_items,semantically_verified_sources,user_quote,observer_notes";
  const rows = Array.from({ length: 6 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    const order = index % 2 === 0 ? "A" : "B";
    const douyinlmSeconds = slow ? 260 : 80;
    return `P${number},true,${order},beach-photo-v1,2026-07-23T10:0${index}:00+08:00,240,10,8,10,${douyinlmSeconds},2,9,10,2,2,true,true,3,3,"任务卡能直接照着做, 不用重看","独立完成来源核查"`;
  });
  return [header, ...rows].join("\n");
}

test("CSV parser preserves quoted commas", () => {
  assert.deepEqual(parseCsv('a,b\n1,"two,three"\n'), [["a", "b"], ["1", "two,three"]]);
});

test("template paths and template content are rejected", () => {
  const result = auditEvaluationEvidence({
    csvText: "participant_id\nP01\n",
    goldenDocument: { status: "template_not_evidence", collection_fingerprint: null, scenarios: [] },
    usersPath: "user-test-results.template.csv",
    goldPath: "golden-labels.template.json",
  });
  assert.equal(result.status, "FAIL");
  assert.match(result.errors.join("\n"), /模板|template/iu);
});

test("six complete balanced participants produce reproducible aggregate metrics", () => {
  const gold = auditGoldenLabels(goldenDocument());
  assert.deepEqual(gold.errors, []);
  const users = auditUserResults(csvEvidence(), gold.scenarioIds);
  assert.deepEqual(users.errors, []);
  assert.equal(users.summary.participants, 6);
  assert.deepEqual(users.summary.order_counts, { A: 3, B: 3 });
  assert.equal(users.summary.metrics.time_reduction.value, 0.6667);
  assert.equal(users.summary.metrics.source_credibility.value, 1);
});

test("unresolved uncertain human label is rejected", () => {
  const result = auditGoldenLabels(goldenDocument({ uncertain: true }));
  assert.match(result.errors.join("\n"), /reviewed_by|resolved_decision/u);
});

test("complete evidence remains PASS when product targets are missed", () => {
  const result = auditEvaluationEvidence({
    csvText: csvEvidence({ slow: true }),
    goldenDocument: goldenDocument(),
    usersPath: "user-test-results.csv",
    goldPath: "golden-labels.json",
  });
  assert.equal(result.status, "PASS");
  assert.equal(result.summary.metrics.time_reduction.met, false);
});
