import type { JsonSchema, ToolDef } from "@/brain/core/tools";
import raw from "@/brain/plugins/google/catalog.json";

const byName = new Map(raw.map((row) => [row.name, row] as const));

/** Name, description, and inputSchema exactly as the Go server publishes them. */
export function toolDef(name: string): ToolDef {
  const row = byName.get(name);
  if (!row) {
    throw new Error(`google catalog missing ${name}`);
  }
  const inputSchema: JsonSchema = {
    type: row.inputSchema.type,
    properties: row.inputSchema.properties,
    required: row.inputSchema.required,
  };
  return { name: row.name, description: row.description, inputSchema };
}

export function catalogNames(): string[] {
  return raw.map((row) => row.name);
}
