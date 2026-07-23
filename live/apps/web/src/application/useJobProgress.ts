import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { JobEventCard, JobEventSubscription } from "../contracts";
import { useGateway } from "../data/gatewayContext";
import { pollJobUntilTerminal } from "./jobProgress";
import { queryKeys } from "./queryKeys";

const TERMINAL_STAGES = new Set(["completed", "ready", "failed", "blocked"]);

export function useJobProgress({
  jobId,
  workspaceId,
  enabled,
  afterSequence = 0,
}: {
  jobId: string | null | undefined;
  workspaceId: string | undefined;
  enabled: boolean;
  afterSequence?: number;
}) {
  const gateway = useGateway();
  const queryClient = useQueryClient();
  const [event, setEvent] = useState<JobEventCard | null>(null);
  const [events, setEvents] = useState<JobEventCard[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [transport, setTransport] = useState<"sse" | "polling">("sse");

  useEffect(() => {
    setEvent(null);
    setEvents([]);
    setError(null);
    setTransport("sse");
  }, [jobId]);

  useEffect(() => {
    if (!enabled || !jobId || !workspaceId) return;
    const abortController = new AbortController();
    let fallbackStarted = false;

    const recordEvent = (nextEvent: JobEventCard) => {
      setEvent(nextEvent);
      setEvents((current) =>
        current.some((entry) => entry.sequence === nextEvent.sequence)
          ? current
          : [...current, nextEvent].sort((left, right) => left.sequence - right.sequence),
      );
    };

    const refreshTruth = () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workspace(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.collection }),
      ]);

    const startPollingFallback = () => {
      if (fallbackStarted || abortController.signal.aborted) return;
      fallbackStarted = true;
      setTransport("polling");
      setError(null);
      void pollJobUntilTerminal(gateway, jobId, {
        signal: abortController.signal,
        onEvent: recordEvent,
      })
        .then((job) => {
          if (job && !abortController.signal.aborted) return refreshTruth();
        })
        .catch((reason: unknown) => {
          if (!abortController.signal.aborted) {
            setError(reason instanceof Error ? reason : new Error("轮询任务状态失败"));
          }
        });
    };

    let subscription: JobEventSubscription | undefined;
    subscription = gateway.subscribeJob(
      jobId,
      {
        onEvent: (nextEvent) => {
          recordEvent(nextEvent);
          if (!TERMINAL_STAGES.has(nextEvent.stage)) return;
          void refreshTruth();
        },
        onError: () => {
          subscription?.close();
          startPollingFallback();
        },
      },
      afterSequence,
    );

    return () => {
      abortController.abort();
      subscription?.close();
    };
  }, [afterSequence, enabled, gateway, jobId, queryClient, workspaceId]);

  return { event, events, error, transport };
}
