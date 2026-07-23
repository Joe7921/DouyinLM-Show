import { useQuery } from "@tanstack/react-query";

import { useGateway } from "../data/gatewayContext";
import { queryKeys } from "./queryKeys";

export function useProvenance(id: string | null) {
  const gateway = useGateway();
  return useQuery({
    queryKey: queryKeys.provenance(id ?? "missing"),
    queryFn: () => gateway.getProvenance(id!),
    enabled: Boolean(id),
    staleTime: Number.POSITIVE_INFINITY,
  });
}
