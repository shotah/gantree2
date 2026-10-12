/**
 * Gemini's OpenAI-compat endpoint often emits parallel tool calls all with
 * index 0 (or omits index). Key on tool call id when present, and treat a new
 * id at the same index as a new call.
 */
export type ToolAcc = { id: string; name: string; args: string };

export class StreamToolBuf {
  private readonly byIndex = new Map<number, ToolAcc>();
  private readonly byId = new Map<string, ToolAcc>();
  readonly order: ToolAcc[] = [];

  accFor(index: number, id: string): ToolAcc {
    if (index < 0) {
      index = 0;
    }
    id = id.trim();
    if (id !== "") {
      const known = this.byId.get(id);
      if (known) {
        this.byIndex.set(index, known);
        return known;
      }
      const current = this.byIndex.get(index);
      if (current && current.id !== "" && current.id !== id) {
        const fresh: ToolAcc = { id, name: "", args: "" };
        this.byId.set(id, fresh);
        this.byIndex.set(index, fresh);
        this.order.push(fresh);
        return fresh;
      }
      let acc = current;
      if (!acc) {
        acc = { id: "", name: "", args: "" };
        this.byIndex.set(index, acc);
        this.order.push(acc);
      }
      acc.id = id;
      this.byId.set(id, acc);
      return acc;
    }
    const atIndex = this.byIndex.get(index);
    if (atIndex) {
      return atIndex;
    }
    const created: ToolAcc = { id: "", name: "", args: "" };
    this.byIndex.set(index, created);
    this.order.push(created);
    return created;
  }
}

/**
 * Providers either send name fragments ("yt"+"music__…") or resend the full
 * name each chunk. A full resend must not double the name.
 */
export function mergeName(acc: ToolAcc, delta: string): void {
  if (delta === "") {
    return;
  }
  if (acc.name === "") {
    acc.name = delta;
    return;
  }
  if (delta.startsWith(acc.name)) {
    acc.name = delta;
    return;
  }
  if (acc.name.startsWith(delta)) {
    return;
  }
  acc.name += delta;
}
