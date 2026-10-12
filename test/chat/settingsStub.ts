import type { AgentRow } from "@/lib/agents/types";

export function settingsInventory(slugs: string[]): DurableObjectNamespace {
  const rows: AgentRow[] = slugs.map((slug) => ({
    slug,
    name: slug,
    createdAt: 0,
    createdBy: "test",
    tags: [],
    enabled: true,
  }));
  return {
    getByName: () => ({
      listAgents: async () => rows,
      getAgent: async (slug: string) => rows.find((row) => row.slug === slug) ?? null,
    }),
  } as unknown as DurableObjectNamespace;
}
