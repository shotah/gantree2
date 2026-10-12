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

export function isSelfTool(name: string): boolean {
  return name === toolNote;
}

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

/** Routes `self_note` at the store. Any other name is an error. */
export class SelfTools {
  constructor(readonly store: SelfNoteStore | null) {}

  defs(): ToolDef[] {
    return [{ ...selfNoteDef, inputSchema: { ...selfNoteDef.inputSchema } }];
  }

  call(name: string, args: Record<string, unknown>, ctx: CallContext): Promise<ToolResult> {
    if (!isSelfTool(name)) {
      return Promise.reject(new Error(`selfnote: unknown tool ${JSON.stringify(name)}`));
    }
    if (!this.store) {
      return Promise.reject(new Error("selfnote: store not configured"));
    }
    return selfNoteTool(this.store).call(args, ctx);
  }
}

/**
 * Self-note first, then the other tools. `self_note` hits the store;
 * everything else is dispatched by name.
 */
export class ToolComposite {
  constructor(
    readonly self: SelfTools,
    readonly other: readonly Tool[] = [],
  ) {}

  tools(): Tool[] {
    const head = this.self.store
      ? selfNoteTool(this.self.store)
      : {
          ...selfNoteDef,
          call(_args: Record<string, unknown>, _ctx: CallContext): Promise<ToolResult> {
            return Promise.reject(new Error("selfnote: store not configured"));
          },
        };
    return [head, ...this.other];
  }

  toolCount(): number {
    return this.tools().length;
  }

  call(name: string, args: Record<string, unknown>, ctx: CallContext): Promise<ToolResult> {
    if (isSelfTool(name)) {
      return this.self.call(name, args, ctx);
    }
    const found = this.other.find((tool) => tool.name === name);
    if (!found) {
      return Promise.reject(new Error(`selfnote: no tool runner for ${JSON.stringify(name)}`));
    }
    return found.call(args, ctx);
  }
}
