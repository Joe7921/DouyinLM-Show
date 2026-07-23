import { describe, expect, it } from "vitest";

import type { JobCard } from "../contracts";
import { isTerminalJob, pollJobUntilTerminal, workspaceDisplayProgress } from "./jobProgress";

const baseJob: JobCard = {
  id: "job-1",
  kind: "compile",
  status: "running",
  video_id: null,
  attempts: 0,
  last_error: null,
  created_at: "2026-07-21T12:00:00+08:00",
  updated_at: "2026-07-21T12:00:01+08:00",
  latest_event: {
    sequence: 1,
    stage: "validating",
    progress: 100,
    message: "进度已满，仍在等待业务状态确认。",
    created_at: "2026-07-21T12:00:01+08:00",
  },
};

describe("job progress truth", () => {
  it("does not treat progress 100 as workspace success", () => {
    expect(isTerminalJob(baseJob)).toBe(false);
    expect(workspaceDisplayProgress("forming", 100)).toBe(96);
    expect(workspaceDisplayProgress("clarifying", 100)).toBe(55);
    expect(workspaceDisplayProgress("ready", 40)).toBe(100);
  });

  it("polls after transport loss until the job status is terminal", async () => {
    const jobs: JobCard[] = [baseJob, { ...baseJob, status: "completed" }];
    let reads = 0;
    const result = await pollJobUntilTerminal(
      { getJob: async () => jobs[Math.min(reads++, jobs.length - 1)]! },
      "job-1",
      {
        signal: new AbortController().signal,
        intervalMs: 0,
        wait: async () => undefined,
      },
    );

    expect(reads).toBe(2);
    expect(result?.status).toBe("completed");
  });
});
