import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { WorkspaceDetail } from "../contracts";
import { useGateway } from "../data/gatewayContext";
import { setArtifactItemChecked } from "../domain/artifact";
import { queryKeys } from "./queryKeys";

export function useArtifactItemCheck(workspaceId: string) {
  const gateway = useGateway();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ artifactId, itemId, checked }: { artifactId: string; itemId: string; checked: boolean }) =>
      gateway.checkArtifactItem(artifactId, itemId, { checked }),
    onMutate: async ({ itemId, checked }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.workspace(workspaceId) });
      const previous = queryClient.getQueryData<WorkspaceDetail>(queryKeys.workspace(workspaceId));
      if (previous) {
        queryClient.setQueryData(
          queryKeys.workspace(workspaceId),
          setArtifactItemChecked(previous, itemId, checked),
        );
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.workspace(workspaceId), context.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.workspace(workspaceId) }),
  });
}

export function useArtifactRevision(
  workspaceId: string,
  onStarted: (jobId: string) => void,
) {
  const gateway = useGateway();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ artifactId, instruction }: { artifactId: string; instruction: string }) =>
      gateway.reviseArtifact(artifactId, { instruction }),
    onSuccess: (response) => {
      onStarted(response.job_id);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workspace(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.collection }),
      ]);
    },
  });
}
