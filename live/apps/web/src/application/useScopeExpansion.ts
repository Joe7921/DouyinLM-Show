import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { ExpandWorkspaceScopeRequest } from "../contracts";
import { useGateway } from "../data/gatewayContext";
import { queryKeys } from "./queryKeys";

export function useScopeExpansion(workspaceId: string | undefined) {
  const gateway = useGateway();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ExpandWorkspaceScopeRequest) => gateway.expandWorkspaceScope(workspaceId!, input),
    onSuccess: async () => {
      if (workspaceId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.workspace(workspaceId) });
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.collection });
    },
  });
}
