export const queryKeys = {
  ready: ["ready"] as const,
  collection: ["collection"] as const,
  category: (id: string) => ["category", id] as const,
  workspace: (id: string) => ["workspace", id] as const,
  job: (id: string) => ["job", id] as const,
  provenance: (id: string) => ["provenance", id] as const,
};
