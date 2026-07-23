import { useQuery } from "@tanstack/react-query";

import { useGateway } from "../data/gatewayContext";
import { queryKeys } from "./queryKeys";

export function useCollection() {
  const gateway = useGateway();
  return useQuery({
    queryKey: queryKeys.collection,
    queryFn: () => gateway.getCollection(),
    refetchInterval: 2500,
  });
}

export function useReadyHealth() {
  const gateway = useGateway();
  return useQuery({
    queryKey: queryKeys.ready,
    queryFn: () => gateway.getReady(),
    refetchInterval: 10_000,
  });
}

export function useCategory(id?: string) {
  const gateway = useGateway();
  return useQuery({
    queryKey: queryKeys.category(id ?? "missing"),
    queryFn: () => gateway.getCategory(id!),
    enabled: Boolean(id),
  });
}
