import type { JobCard, JobEventCard, WorkspaceState } from "../contracts";
import type { DouyinLMGateway } from "../data/gateway";

export function isTerminalJob(job: JobCard): boolean {
  return job.status === "completed" || job.status === "failed" || job.status === "blocked";
}

export function workspaceDisplayProgress(state: WorkspaceState, eventProgress?: number): number {
  if (state === "ready") return 100;
  if (state === "clarifying") return 55;
  return Math.min(eventProgress ?? 8, 96);
}

export async function pollJobUntilTerminal(
  gateway: Pick<DouyinLMGateway, "getJob">,
  jobId: string,
  options: {
    signal: AbortSignal;
    intervalMs?: number;
    wait?: (milliseconds: number) => Promise<void>;
    onEvent?: (event: JobEventCard) => void;
  },
): Promise<JobCard | null> {
  const wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const intervalMs = options.intervalMs ?? 1200;

  while (!options.signal.aborted) {
    const job = await gateway.getJob(jobId);
    if (job.latest_event) options.onEvent?.(job.latest_event);
    if (isTerminalJob(job)) return job;
    await wait(intervalMs);
  }
  return null;
}
