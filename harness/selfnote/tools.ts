/**
 * Builtin `self_note` tool. Append-only; distill on /new merges later.
 */
import { textResult, type CallContext, type Tool, type ToolDef, type ToolResult } from "@/harness/core/tools";
import type { SelfNoteStore } from "./store";

export const toolNote = "self_note";

const description = "APPEND one short new line to SELF.md (does not overwrite or distill the file). "
  + "Only for a vibe, joke, ritual, or north-star aim that is NOT already in the SELF.md bullets in your prompt — skip if it is already there or only a paraphrase. "
  + "A north-star is one sentence for months (how you show up). When they state one, write it here. Progress logs and one-off to-dos are memory_store or cron, not this. "
  + "/new distill merges (does not flatten jokes). Not for facts about the human — use memory_store for those.";

export const selfNoteDef: ToolDef = {
  name: toolNote,
  description,
  inputSchema: {
    type: "object",
    properties: {
      note: {
        type: "string",
        description: "one NEW short line (dozen words or fewer); skip if already covered in SELF.md",
      },
    },
    required: ["note"],
  },
};

const appended = "appended one line to SELF.md (append-only; /new distill merges later). Skip next time if already listed.";

function noteArg(args: Record<string, unknown>): string {
  if (!Object.prototype.hasOwnProperty.call(args, "note")) {
    return "";
  }
  if (typeof args.note !== "string") {
    throw new Error("selfnote: bad arguments");
  }
  return args.note;
}

export function selfNoteTool(store: SelfNoteStore): Tool {
  return {
    ...selfNoteDef,
    call(args: Record<string, unknown>, _ctx: CallContext): Promise<ToolResult> {
      store.append(noteArg(args));
      return Promise.resolve(textResult(appended));
    },
  };
}
