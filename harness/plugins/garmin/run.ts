import type { Tool, ToolResult } from "@/harness/core/tools";
import { errorResult, textResult } from "@/harness/core/tools";
import { errorMessage, goJSON } from "./json";

export async function toolCall(fn: () => unknown): Promise<ToolResult> {
  try {
    return textResult(goJSON(await fn()));
  } catch (err) {
    return errorResult(errorMessage(err));
  }
}

export function tool(def: Pick<Tool, "name" | "description" | "inputSchema" | "single">, fn: Tool["call"]): Tool {
  return { ...def, call: fn };
}
