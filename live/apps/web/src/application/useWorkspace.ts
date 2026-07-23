import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useGateway } from "../data/gatewayContext";
import { queryKeys } from "./queryKeys";

export function useWorkspace(id: string | undefined) {
  const gateway = useGateway();
  return useQuery({
    queryKey: queryKeys.workspace(id ?? "missing"),
    queryFn: () => gateway.getWorkspace(id!),
    enabled: Boolean(id),
  });
}

export function useRetryWorkspaceJob(workspaceId: string | undefined) {
  const gateway = useGateway();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => gateway.retryJob(jobId),
    onSuccess: async () => {
      if (workspaceId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.workspace(workspaceId) });
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.collection });
    },
  });
}
