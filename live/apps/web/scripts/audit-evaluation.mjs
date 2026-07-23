import { readFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";

const PLACEHOLDER = /(?:replace|placeholder|template|待填写|待补|示例)/iu;
const SHA256 = /^[a-f0-9]{64}$/iu;
const ZONED_TIME = /(?:Z|[+-]\d{2}:\d{2})$/u;

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/u, "");

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      if (field.length > 0) throw new Error("CSV 引号必须从字段开头出现");
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("CSV 存在未闭合引号");
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/u, ""));
    rows.push(row);
  }
  return rows.filter((values) => values.some((value) => value.trim().length > 0));
}

function parseBoolean(value, field, errors) {
  if (value === "true") return true;
  if (value === "false") return false;
  errors.push(`${field} 必须为 true 或 false`);
  return false;
}

function parseNumber(value, field, errors, { minimum = 0, integer = false } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || (integer && !Number.isInteger(parsed))) {
    errors.push(`${field} 必须为${integer ? "整数" : "数字"}且不小于 ${minimum}`);
    return 0;
  }
  return parsed;
}

function nonPlaceholder(value) {
  return typeof value === "string" && value.trim().length > 0 && !PLACEHOLDER.test(value);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

function validSourceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "douyin.com" || url.hostname.endsWith(".douyin.com"));
  } catch {
    return false;
  }
}

export function auditGoldenLabels(document) {
  const errors = [];
  const scenarioIds = new Set();
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return { errors: ["gold labels 根节点必须为对象"], scenarioIds };
  }
  if (document.status === "template_not_evidence") errors.push("gold labels 仍是模板，不是证据");
  if (!SHA256.test(String(document.collection_fingerprint ?? ""))) {
    errors.push("collection_fingerprint 必须为真实 64 位 SHA-256");
  }
  if (!Array.isArray(document.scenarios) || document.scenarios.length === 0) {
    errors.push("gold labels 至少需要一个场景");
    return { errors, scenarioIds };
  }

  document.scenarios.forEach((scenario, scenarioIndex) => {
    const prefix = `scenarios[${scenarioIndex}]`;
    if (!nonPlaceholder(scenario.scenario_id)) errors.push(`${prefix}.scenario_id 缺失或仍为占位值`);
    else if (scenarioIds.has(scenario.scenario_id)) errors.push(`${prefix}.scenario_id 重复`);
    else scenarioIds.add(scenario.scenario_id);
    if (!nonPlaceholder(scenario.goal)) errors.push(`${prefix}.goal 缺失或仍为占位值`);
    if (!nonPlaceholder(scenario.annotated_by)) errors.push(`${prefix}.annotated_by 缺失或仍为占位值`);
    if (!nonPlaceholder(scenario.workspace_id)) errors.push(`${prefix}.workspace_id 缺失`);
    if (!nonPlaceholder(scenario.run_id)) errors.push(`${prefix}.run_id 缺失`);
    if (!nonPlaceholder(scenario.annotated_at) || !ZONED_TIME.test(scenario.annotated_at) || Number.isNaN(Date.parse(scenario.annotated_at))) {
      errors.push(`${prefix}.annotated_at 必须为带时区 ISO 8601`);
    }
    if (!Array.isArray(scenario.candidates) || scenario.candidates.length === 0) {
      errors.push(`${prefix}.candidates 不能为空`);
      return;
    }
    const hashes = new Set();
    scenario.candidates.forEach((candidate, candidateIndex) => {
      const candidatePrefix = `${prefix}.candidates[${candidateIndex}]`;
      if (!SHA256.test(String(candidate.source_hash ?? ""))) errors.push(`${candidatePrefix}.source_hash 无效`);
      else if (hashes.has(candidate.source_hash)) errors.push(`${candidatePrefix}.source_hash 重复`);
      else hashes.add(candidate.source_hash);
      for (const field of ["filename", "title", "author", "reason"]) {
        if (!nonPlaceholder(candidate[field])) errors.push(`${candidatePrefix}.${field} 缺失或仍为占位值`);
      }
      if (!validSourceUrl(candidate.source_url)) errors.push(`${candidatePrefix}.source_url 必须为真实 HTTPS 抖音链接`);
      if (!["adopt", "exclude", "uncertain"].includes(candidate.expected_decision)) {
        errors.push(`${candidatePrefix}.expected_decision 无效`);
      }
      if (candidate.expected_decision === "uncertain") {
        if (!nonPlaceholder(candidate.reviewed_by)) errors.push(`${candidatePrefix}.reviewed_by 缺失`);
        if (!["adopt", "exclude"].includes(candidate.resolved_decision)) errors.push(`${candidatePrefix}.resolved_decision 必须解决为 adopt/exclude`);
      }
      if (!Array.isArray(candidate.evidence_ranges) || candidate.evidence_ranges.length === 0) {
        errors.push(`${candidatePrefix}.evidence_ranges 不能为空`);
      } else {
        candidate.evidence_ranges.forEach((range, rangeIndex) => {
          const rangePrefix = `${candidatePrefix}.evidence_ranges[${rangeIndex}]`;
          if (!Number.isInteger(range.start_ms) || !Number.isInteger(range.end_ms) || range.start_ms < 0 || range.end_ms <= range.start_ms) {
            errors.push(`${rangePrefix} 必须满足 0 <= start_ms < end_ms`);
          }
          if (!nonPlaceholder(range.summary)) errors.push(`${rangePrefix}.summary 缺失或仍为占位值`);
        });
      }
    });
  });
  return { errors, scenarioIds };
}

export function auditUserResults(csvText, scenarioIds) {
  const errors = [];
  let rows;
  try {
    rows = parseCsv(csvText);
  } catch (error) {
    return { errors: [error instanceof Error ? error.message : String(error)], summary: null };
  }
  if (rows.length < 2) return { errors: ["用户测试 CSV 没有数据行"], summary: null };
  const headers = rows[0].map((value) => value.trim());
  const requiredHeaders = [
    "participant_id", "consent_recorded", "test_order", "scenario_id", "observed_at",
    "baseline_seconds", "baseline_video_replays", "baseline_completed_steps", "baseline_total_steps",
    "douyinlm_seconds", "douyinlm_source_opens", "douyinlm_completed_steps", "douyinlm_total_steps",
    "selection_matches", "selection_labels", "revision_requested", "revision_succeeded",
    "key_action_items", "semantically_verified_sources", "user_quote", "observer_notes",
  ];
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) return { errors: [`用户测试 CSV 缺字段：${missingHeaders.join(", ")}`], summary: null };
  const participants = [];
  const participantIds = new Set();

  rows.slice(1).forEach((values, rowIndex) => {
    const line = rowIndex + 2;
    if (values.length !== headers.length) {
      errors.push(`CSV 第 ${line} 行字段数与表头不一致`);
      return;
    }
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index].trim()]));
    const prefix = `CSV 第 ${line} 行`;
    if (!/^P[0-9]{2,}$/u.test(record.participant_id)) errors.push(`${prefix} participant_id 必须是 P01 形式匿名编号`);
    else if (participantIds.has(record.participant_id)) errors.push(`${prefix} participant_id 重复`);
    else participantIds.add(record.participant_id);
    const consent = parseBoolean(record.consent_recorded, `${prefix} consent_recorded`, errors);
    if (!consent) errors.push(`${prefix} 未记录参与同意`);
    if (!["A", "B"].includes(record.test_order)) errors.push(`${prefix} test_order 必须为 A 或 B`);
    if (!scenarioIds.has(record.scenario_id)) errors.push(`${prefix} scenario_id 不存在于 gold labels`);
    if (!nonPlaceholder(record.observed_at) || !ZONED_TIME.test(record.observed_at) || Number.isNaN(Date.parse(record.observed_at))) {
      errors.push(`${prefix} observed_at 必须为带时区 ISO 8601`);
    }
    const numeric = {
      baselineSeconds: parseNumber(record.baseline_seconds, `${prefix} baseline_seconds`, errors, { minimum: 0.001 }),
      baselineReplays: parseNumber(record.baseline_video_replays, `${prefix} baseline_video_replays`, errors, { integer: true }),
      baselineCompleted: parseNumber(record.baseline_completed_steps, `${prefix} baseline_completed_steps`, errors, { integer: true }),
      baselineTotal: parseNumber(record.baseline_total_steps, `${prefix} baseline_total_steps`, errors, { minimum: 1, integer: true }),
      douyinlmSeconds: parseNumber(record.douyinlm_seconds, `${prefix} douyinlm_seconds`, errors, { minimum: 0.001 }),
      sourceOpens: parseNumber(record.douyinlm_source_opens, `${prefix} douyinlm_source_opens`, errors, { integer: true }),
      douyinlmCompleted: parseNumber(record.douyinlm_completed_steps, `${prefix} douyinlm_completed_steps`, errors, { integer: true }),
      douyinlmTotal: parseNumber(record.douyinlm_total_steps, `${prefix} douyinlm_total_steps`, errors, { minimum: 1, integer: true }),
      selectionMatches: parseNumber(record.selection_matches, `${prefix} selection_matches`, errors, { integer: true }),
      selectionLabels: parseNumber(record.selection_labels, `${prefix} selection_labels`, errors, { minimum: 1, integer: true }),
      keyItems: parseNumber(record.key_action_items, `${prefix} key_action_items`, errors, { minimum: 1, integer: true }),
      verifiedSources: parseNumber(record.semantically_verified_sources, `${prefix} semantically_verified_sources`, errors, { integer: true }),
    };
    if (numeric.baselineCompleted > numeric.baselineTotal) errors.push(`${prefix} baseline 完成项不能大于总项`);
    if (numeric.douyinlmCompleted > numeric.douyinlmTotal) errors.push(`${prefix} douyinLM 完成项不能大于总项`);
    if (numeric.selectionMatches > numeric.selectionLabels) errors.push(`${prefix} selection_matches 不能大于 selection_labels`);
    if (numeric.verifiedSources > numeric.keyItems) errors.push(`${prefix} semantically_verified_sources 不能大于 key_action_items`);
    const revisionRequested = parseBoolean(record.revision_requested, `${prefix} revision_requested`, errors);
    const revisionSucceeded = parseBoolean(record.revision_succeeded, `${prefix} revision_succeeded`, errors);
    if (!revisionRequested) errors.push(`${prefix} 必须实际发起一句话修改`);
    if (!nonPlaceholder(record.user_quote)) errors.push(`${prefix} user_quote 缺失或仍为占位值`);
    if (!nonPlaceholder(record.observer_notes)) errors.push(`${prefix} observer_notes 缺失或仍为占位值`);
    participants.push({ ...numeric, order: record.test_order, revisionRequested, revisionSucceeded });
  });

  if (participantIds.size < 6) errors.push("至少需要 6 名唯一真实参与者");
  if (!participants.some((item) => item.order === "A") || !participants.some((item) => item.order === "B")) {
    errors.push("A/B 两种测试顺序都必须有样本");
  }
  if (errors.length > 0) return { errors, summary: null };

  const baselineMedian = median(participants.map((item) => item.baselineSeconds));
  const douyinlmMedian = median(participants.map((item) => item.douyinlmSeconds));
  const replayMedian = median(participants.map((item) => item.baselineReplays));
  const sourceOpenMedian = median(participants.map((item) => item.sourceOpens));
  const timeReduction = ratio(baselineMedian - douyinlmMedian, baselineMedian);
  const replayReduction = ratio(replayMedian - sourceOpenMedian, replayMedian);
  const selectionAccuracy = ratio(
    participants.reduce((sum, item) => sum + item.selectionMatches, 0),
    participants.reduce((sum, item) => sum + item.selectionLabels, 0),
  );
  const taskCompletion = ratio(
    participants.reduce((sum, item) => sum + item.douyinlmCompleted, 0),
    participants.reduce((sum, item) => sum + item.douyinlmTotal, 0),
  );
  const revisionSuccess = ratio(
    participants.filter((item) => item.revisionRequested && item.revisionSucceeded).length,
    participants.filter((item) => item.revisionRequested).length,
  );
  const sourceCredibility = ratio(
    participants.reduce((sum, item) => sum + item.verifiedSources, 0),
    participants.reduce((sum, item) => sum + item.keyItems, 0),
  );
  return {
    errors,
    summary: {
      participants: participantIds.size,
      order_counts: {
        A: participants.filter((item) => item.order === "A").length,
        B: participants.filter((item) => item.order === "B").length,
      },
      metrics: {
        baseline_median_seconds: baselineMedian,
        douyinlm_median_seconds: douyinlmMedian,
        time_reduction: { value: timeReduction, target: 0.5, met: timeReduction >= 0.5 },
        replay_reduction: { value: replayReduction, target: 0.7, met: replayReduction >= 0.7 },
        selection_accuracy: { value: selectionAccuracy, target: 0.9, met: selectionAccuracy >= 0.9 },
        task_completion: { value: taskCompletion, target: 0.8, met: taskCompletion >= 0.8 },
        revision_success: { value: revisionSuccess, target: 0.8, met: revisionSuccess >= 0.8 },
        source_credibility: { value: sourceCredibility, target: 1, met: sourceCredibility === 1 },
      },
    },
  };
}

export function auditEvaluationEvidence({ csvText, goldenDocument, usersPath = "", goldPath = "" }) {
  const filenameErrors = [];
  if (usersPath.includes(".template.")) filenameErrors.push("用户测试文件仍是 .template，不能作为证据");
  if (goldPath.includes(".template.")) filenameErrors.push("gold labels 文件仍是 .template，不能作为证据");
  const golden = auditGoldenLabels(goldenDocument);
  const users = auditUserResults(csvText, golden.scenarioIds);
  const errors = [...filenameErrors, ...golden.errors, ...users.errors];
  return {
    status: errors.length === 0 ? "PASS" : "FAIL",
    errors,
    summary: errors.length === 0 ? users.summary : null,
  };
}

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--users" || argument === "--gold") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} 缺少路径`);
      result[argument.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`未知参数：${argument}`);
    }
  }
  if (!result.users || !result.gold) throw new Error("用法：--users <csv> --gold <json>");
  return result;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const [csvText, goldText] = await Promise.all([
    readFile(options.users, "utf8"),
    readFile(options.gold, "utf8"),
  ]);
  const result = auditEvaluationEvidence({
    csvText,
    goldenDocument: JSON.parse(goldText),
    usersPath: options.users,
    goldPath: options.gold,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
