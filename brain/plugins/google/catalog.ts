import type { JsonSchema, ToolDef } from "@/brain/core/tools";
import raw from "@/brain/plugins/google/catalog.json";

const byName = new Map(raw.map((row) => [row.name, row] as const));

const USER_GOOGLE_EMAIL_DESCRIPTION
  = "Google account for this call: the person's work, personal, or other mailbox. If you do not already know which one, ask them before calling, then pass that address here. Do not guess.";

/** Name, description, and inputSchema exactly as the Go server publishes them. */
export function toolDef(name: string): ToolDef {
  const row = byName.get(name);
  if (!row) {
    throw new Error(`google catalog missing ${name}`);
  }
  const properties = { ...row.inputSchema.properties };
  const emailProp = properties.user_google_email;
  if (emailProp && typeof emailProp === "object" && !Array.isArray(emailProp)) {
    properties.user_google_email = {
      ...emailProp,
      description: USER_GOOGLE_EMAIL_DESCRIPTION,
    };
  }
  const inputSchema: JsonSchema = {
    type: row.inputSchema.type,
    properties,
    required: row.inputSchema.required,
  };
  return { name: row.name, description: row.description, inputSchema };
}

export function catalogNames(): string[] {
  return raw.map((row) => row.name);
}
