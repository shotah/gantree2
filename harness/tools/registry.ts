/**
 * In-process tool host. Plugins replace the stdio MCP servers.
 *
 * The model sees `{plugin}__{tool}` (`maps__place_search`). On call, an
 * underscored prefix is retried with hyphens, and a real tool suffix with
 * an invented or missing prefix is repaired when exactly one published
 * tool has that suffix. A real prefix with the wrong tool is not hopped
 * to another plugin. Two plugins publishing the same suffix are left for
 * the model.
 *
 * `publish` is the `status` frame. `list` is the catalog for one session.
 * `call` truncates successful text and turns failures into tool-error text.
 * Pass `signal` on the call context for a timeout; abort rejects the call.
 */
import { errorResult, type CallContext, type JsonSchema, type Plugin, type PluginContext, type Tool, type ToolDef, type ToolResult } from "@/harness/core/tools";
import { type StatusFrame } from "@/harness/core/wire";
import {
  allowed,
  alwaysOn,
  ENABLE_TOOL_NAME,
  enableHint,
  enableIndex,
  enableToolDef,
  runEnableTool,
  type EnableStore,
} from "./enable";
import { classifyReason, clipNote, errorMessage, toolErrorText, unavailableMessage } from "./errors";
import { compareName, hyphenatePrefix, prefixedName, sanitizeName, uniqueSorted } from "./names";
import { modelView } from "./result";
import { DEFAULT_RESULT_MAX_CHARS, truncate } from "./truncate";

const MAX_HINT_TOOLS = 12;
const MAX_TOOL_SUGGESTIONS = 5;

const GENERIC_TOOL_TOKENS = new Set([
  "get",
  "list",
  "set",
  "search",
  "create",
  "update",
  "delete",
  "add",
  "and",
  "or",
  "my",
  "the",
  "data",
  "info",
]);

export type RegistryOptions = {
  /** Code-point cap for model text. `0` disables. Default 6000. */
  resultMaxChars?: number;
  /**
   * When true (default), `list` publishes builtins, force prefixes, and
   * `sessionEnabled` only, and prepends `mcp_enable`. When false, `list`
   * is the full catalog.
   */
  dynamicTools?: boolean;
  /** Always-on prefixes while dynamic tools are on (`mcp.toml` force, `MCP_ENABLE_FORCE`). */
  forcePrefixes?: readonly string[];
  /** Unprefixed builtins (`memory_store`, `web_search`). They are always published. */
  builtins?: readonly Tool[];
  /** Required for `mcp_enable` and for `call` to honor per-session prefixes. */
  enable?: EnableStore;
};

/** `ToolResult` plus the hint the agent loop uses to constrain a retry. */
export type ToolCallResult = ToolResult & {
  /** Real prefixed names, best guess first. Set on an unknown-tool error. */
  candidates?: string[];
  /** Data URLs for `photo_generate` / `photo_edit`. Not part of the model text. */
  images?: string[];
};

type LiveTool = {
  server: string;
  originalName: string;
  suffix: string;
  qualified: string;
  tool: Tool;
};

type SkippedServer = { name: string; reason: string; note: string };

export class Registry {
  constructor(plugins: readonly Plugin[], ctx: PluginContext, options?: RegistryOptions) {
    this.plugins = [...plugins];
    this.ctx = ctx;
    this.resultMaxChars = options?.resultMaxChars ?? DEFAULT_RESULT_MAX_CHARS;
    this.dynamic = options?.dynamicTools ?? true;
    this.forceList = [...(options?.forcePrefixes ?? [])];
    this.builtins = [...(options?.builtins ?? [])];
    this.store = options?.enable ?? null;
  }

  /** Ask each plugin `ready()`, then build the catalog. Fail-soft per plugin. */
  publish(): Promise<StatusFrame> {
    const run = this.pending.then(() => this.publishNow());
    this.pending = run.then(() => undefined, () => undefined);
    return run;
  }

  /**
   * Tool defs for the model, sorted by name so the prompt prefix stays
   * cacheable. `sessionEnabled` is the prefixes `EnableStore.list` returned
   * for this session. Ignored when dynamic tools are off.
   */
  list(sessionEnabled: readonly string[] = []): ToolDef[] {
    this.assertPublished();
    const defs = this.sortedDefs().filter((def) => def.name !== ENABLE_TOOL_NAME);
    if (!this.dynamic) {
      return defs;
    }
    const force = { prefixes: this.forceList };
    const filtered = defs.filter((def) => allowed(def.name, sessionEnabled, force));
    return [enableToolDef(), ...filtered];
  }

  /** Prefixed catalog size, not counting builtins or `mcp_enable`. */
  toolCount(): number {
    this.assertPublished();
    let count = 0;
    for (const live of this.tools.values()) {
      if (live.server) {
        count += 1;
      }
    }
    return count;
  }

  dynamicTools(): boolean {
    return this.dynamic;
  }

  forcePrefixes(): string[] {
    return [...this.forceList];
  }

  /** Enable keys (`google`, `google__calendar`, …) for the published catalog. */
  indexKeys(): string[] {
    this.assertPublished();
    return enableIndex(this.sortedDefs());
  }

  /** Published plugin names, in constructor order. */
  servers(): string[] {
    this.assertPublished();
    return [...this.publishedNames];
  }

  /** Unprefixed tool suffixes for one plugin, sorted and de-duplicated. */
  originalNames(server: string): string[] {
    this.assertPublished();
    const names: string[] = [];
    for (const live of this.tools.values()) {
      if (live.server === server) {
        names.push(live.suffix);
      }
    }
    return uniqueSorted(names);
  }

  call(name: string, args: Record<string, unknown>, callCtx: CallContext): Promise<ToolCallResult> {
    return this.dispatch(name, args, callCtx, false);
  }

  /** `call` without the result cap. Machine consumers need intact JSON. */
  callRaw(name: string, args: Record<string, unknown>, callCtx: CallContext): Promise<ToolCallResult> {
    return this.dispatch(name, args, callCtx, true);
  }

  private readonly plugins: readonly Plugin[];
  private readonly ctx: PluginContext;
  private readonly resultMaxChars: number;
  private readonly dynamic: boolean;
  private readonly forceList: readonly string[];
  private readonly builtins: readonly Tool[];
  private readonly store: EnableStore | null;
  private pending: Promise<void> = Promise.resolve();
  private didPublish = false;
  private tools = new Map<string, LiveTool>();
  private skipped: SkippedServer[] = [];
  private publishedNames: string[] = [];

  private async publishNow(): Promise<StatusFrame> {
    const published: string[] = [];
    const skippedFrame: { name: string; reason: string }[] = [];
    const skipped: SkippedServer[] = [];
    const tools = new Map<string, LiveTool>();
    const seen = new Set<string>();

    for (const plugin of this.plugins) {
      const name = plugin.name.trim();
      if (!name || seen.has(name)) {
        const note = name ? "duplicate server name" : "empty server name";
        skippedFrame.push({ name: name || plugin.name, reason: "error" });
        skipped.push({ name: name || plugin.name, reason: "error", note });
        continue;
      }
      seen.add(name);
      const skip = await readyOf(plugin, this.ctx);
      if (skip) {
        skippedFrame.push({ name, reason: skip.reason });
        skipped.push({ name, reason: skip.reason, note: skip.note });
        logSkip(this.ctx.log, name, skip.reason);
        continue;
      }
      const loaded = loadTools(plugin, this.ctx, tools);
      if (!Array.isArray(loaded)) {
        skippedFrame.push({ name, reason: loaded.reason });
        skipped.push({ name, reason: loaded.reason, note: loaded.note });
        logSkip(this.ctx.log, name, loaded.reason);
        continue;
      }
      for (const live of loaded) {
        tools.set(live.qualified, live);
      }
      published.push(name);
      const prefix = sanitizeName(name);
      this.ctx.log.info("mcp server connected", { server: name, tools_published: loaded.length, prefix });
    }

    for (const builtin of this.builtins) {
      if (!builtin.name || tools.has(builtin.name)) {
        continue;
      }
      tools.set(builtin.name, {
        server: "",
        originalName: builtin.name,
        suffix: builtin.name,
        qualified: builtin.name,
        tool: builtin,
      });
    }

    this.tools = tools;
    this.skipped = skipped;
    this.publishedNames = published;
    this.didPublish = true;
    this.ctx.log.info("mcp host ready", {
      servers: published.length,
      tools: this.toolCountUnsafe(),
      skipped: skippedFrame.length,
      dynamic_tools: this.dynamic,
    });
    return { kind: "status", published, skipped: skippedFrame };
  }

  private async dispatch(name: string, args: Record<string, unknown>, callCtx: CallContext, raw: boolean): Promise<ToolCallResult> {
    this.assertPublished();
    if (callCtx.signal?.aborted) {
      throw abortError(callCtx.signal);
    }
    if (name === ENABLE_TOOL_NAME && this.dynamic) {
      const parsed = normalizeArgs(args);
      if (!parsed) {
        return errorResult(toolErrorText("mcpenable: bad arguments"));
      }
      return runEnableTool(this.store, parsed, callCtx.sessionId, this.indexKeys());
    }
    const live = this.resolve(name);
    if (!live) {
      const skipped = this.unavailable(name);
      if (skipped) {
        return errorResult(unavailableMessage(skipped.name, skipped.reason, skipped.note));
      }
      return this.unknown(name);
    }
    if (live.qualified !== name) {
      this.ctx.log.info("mcp tool name aliased", { requested: name, resolved: live.qualified });
    }
    const blocked = this.blocked(live.qualified, callCtx.sessionId);
    if (blocked) {
      return errorResult(toolErrorText(blocked));
    }
    const parsed = normalizeArgs(args);
    if (!parsed) {
      return errorResult(toolErrorText(`mcp: invalid arguments for ${JSON.stringify(name)}`));
    }
    let result: ToolResult;
    try {
      result = await raceSignal(callCtx.signal, Promise.resolve().then(() => live.tool.call(parsed, callCtx)));
    } catch (err) {
      if (callCtx.signal?.aborted || isAbort(err)) {
        throw isAbort(err) && err instanceof Error ? err : abortError(callCtx.signal);
      }
      return errorResult(toolErrorText(errorMessage(err)));
    }
    if (!result || !Array.isArray(result.content)) {
      return errorResult(toolErrorText("empty tool result"));
    }
    const view = modelView(result, live.originalName);
    if (result.isError) {
      return errorResult(toolErrorText(view.text));
    }
    const text = raw ? view.text : truncate(view.text, this.resultMaxChars);
    this.touch(callCtx.sessionId, live.qualified);
    const outcome: ToolCallResult = { content: [{ type: "text", text }] };
    if (view.images.length > 0) {
      outcome.images = view.images;
    }
    return outcome;
  }

  private resolve(toolName: string): LiveTool | null {
    const exact = this.tools.get(toolName);
    if (exact) {
      return exact;
    }
    const alt = hyphenatePrefix(toolName);
    if (alt) {
      const hit = this.tools.get(alt);
      if (hit) {
        return hit;
      }
    }
    return this.resolveLoose(toolName);
  }

  private resolveLoose(toolName: string): LiveTool | null {
    const cut = toolName.indexOf("__");
    let base = toolName;
    if (cut >= 0) {
      const prefix = toolName.slice(0, cut);
      if (this.hasServerPrefix(prefix)) {
        return null;
      }
      base = toolName.slice(cut + 2);
    }
    base = base.toLowerCase();
    if (!base) {
      return null;
    }
    let found: LiveTool | null = null;
    let matches = 0;
    for (const [qualified, live] of this.tools) {
      const sep = qualified.indexOf("__");
      if (sep < 0) {
        continue;
      }
      if (qualified.slice(sep + 2).toLowerCase() !== base) {
        continue;
      }
      matches += 1;
      found = live;
    }
    if (matches !== 1) {
      return null;
    }
    return found;
  }

  private hasServerPrefix(prefix: string): boolean {
    const want = `${prefix}__`;
    for (const name of this.tools.keys()) {
      if (name.startsWith(want)) {
        return true;
      }
    }
    return false;
  }

  private unavailable(toolName: string): SkippedServer | null {
    const cut = toolName.indexOf("__");
    const prefix = cut >= 0 ? toolName.slice(0, cut) : toolName;
    const direct = this.skippedMatching(prefix);
    if (direct) {
      return direct;
    }
    const alt = prefix.replaceAll("_", "-");
    if (alt === prefix) {
      return null;
    }
    return this.skippedMatching(alt);
  }

  private skippedMatching(prefix: string): SkippedServer | null {
    for (const row of this.skipped) {
      if (row.name === prefix || sanitizeName(row.name) === prefix) {
        return row;
      }
    }
    return null;
  }

  private unknown(toolName: string): ToolCallResult {
    const { hint, candidates } = this.suggest(toolName);
    const result: ToolCallResult = errorResult(toolErrorText(`mcp: unknown tool ${JSON.stringify(toolName)} — ${hint}`));
    if (candidates.length > 0) {
      result.candidates = candidates;
    }
    return result;
  }

  private suggest(toolName: string): { hint: string; candidates: string[] } {
    const near = this.nearest(toolName);
    const cut = toolName.indexOf("__");
    if (cut >= 0) {
      const prefix = toolName.slice(0, cut);
      const names = this.toolsWithPrefix(prefix);
      if (names.length > 0) {
        const { shown, extra } = clipToolNames(names, MAX_HINT_TOOLS);
        return {
          hint: `no such tool; valid ${prefix} tools include: ${shown.join(", ")}${extra} — if this was the wrong integration, use another server prefix; otherwise retry with one of these exact names`,
          candidates: near,
        };
      }
      const alt = hyphenatePrefix(toolName);
      if (alt) {
        const altCut = alt.indexOf("__");
        const altPrefix = alt.slice(0, altCut);
        const altNames = this.toolsWithPrefix(altPrefix);
        if (altNames.length > 0) {
          const { shown, extra } = clipToolNames(altNames, MAX_HINT_TOOLS);
          return {
            hint: `no such tool or server prefix ${JSON.stringify(prefix)} (did you mean ${JSON.stringify(altPrefix)}?); valid ${altPrefix} tools include: ${shown.join(", ")}${extra} — if this was the wrong integration, use another server prefix; otherwise retry with one of these exact names`,
            candidates: near,
          };
        }
      }
    }
    const prefixes = this.serverPrefixes();
    const prefixLine = `available server prefixes are: ${prefixes.join(", ")}`;
    if (near.length > 0) {
      return {
        hint: `no such tool; closest real names are: ${near.join(", ")} — retry with one of these exact names; ${prefixLine}`,
        candidates: near,
      };
    }
    return { hint: `no such tool or server prefix; ${prefixLine}`, candidates: [] };
  }

  private nearest(toolName: string): string[] {
    const cut = toolName.indexOf("__");
    const base = cut >= 0 ? toolName.slice(cut + 2) : toolName;
    const want = meaningfulTokens(base);
    if (want.size === 0) {
      return [];
    }
    const ranked: { name: string; score: number }[] = [];
    for (const name of this.tools.keys()) {
      const sep = name.indexOf("__");
      if (sep < 0) {
        continue;
      }
      let score = 0;
      for (const token of meaningfulTokens(name.slice(sep + 2))) {
        if (want.has(token)) {
          score += 1;
        }
      }
      if (score > 0) {
        ranked.push({ name, score });
      }
    }
    ranked.sort((a, b) => b.score - a.score || compareName(a.name, b.name));
    return ranked.slice(0, MAX_TOOL_SUGGESTIONS).map((row) => row.name);
  }

  private toolsWithPrefix(prefix: string): string[] {
    const want = `${prefix}__`;
    const names: string[] = [];
    for (const name of this.tools.keys()) {
      if (name.startsWith(want)) {
        names.push(name);
      }
    }
    names.sort(compareName);
    return names;
  }

  private serverPrefixes(): string[] {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const name of this.tools.keys()) {
      const cut = name.indexOf("__");
      if (cut <= 0) {
        continue;
      }
      const prefix = name.slice(0, cut);
      if (seen.has(prefix)) {
        continue;
      }
      seen.add(prefix);
      names.push(prefix);
    }
    names.sort(compareName);
    return names;
  }

  private blocked(qualified: string, sessionId: string): string | null {
    if (!this.dynamic || alwaysOn(qualified) || qualified === ENABLE_TOOL_NAME) {
      return null;
    }
    if (!sessionId.trim()) {
      return null;
    }
    const enabled = this.store ? this.store.list(sessionId).map((row) => row.prefix) : [];
    if (allowed(qualified, enabled, { prefixes: this.forceList })) {
      return null;
    }
    return enableHint(qualified, this.indexKeys());
  }

  private touch(sessionId: string, qualified: string): void {
    if (!this.dynamic || !this.store || !sessionId.trim() || alwaysOn(qualified)) {
      return;
    }
    this.store.touch(sessionId, qualified);
  }

  private sortedDefs(): ToolDef[] {
    const defs: ToolDef[] = [];
    for (const live of this.tools.values()) {
      defs.push({
        name: live.qualified,
        description: live.tool.description,
        inputSchema: schemaOf(live.tool.inputSchema),
      });
    }
    defs.sort((a, b) => compareName(a.name, b.name));
    return defs;
  }

  private toolCountUnsafe(): number {
    let count = 0;
    for (const live of this.tools.values()) {
      if (live.server) {
        count += 1;
      }
    }
    return count;
  }

  private assertPublished(): void {
    if (!this.didPublish) {
      throw new Error("registry.publish() has not been called");
    }
  }
}

/** A missing key or a plugin that is off is expected. A load failure stays an error. */
function logSkip(log: PluginContext["log"], name: string, reason: string): void {
  const fields = { plugin: name, reason };
  if (reason === "no_key" || reason === "disabled") {
    log.info("plugin skipped", fields);
    return;
  }
  log.error("plugin skipped", fields);
}

async function readyOf(plugin: Plugin, ctx: PluginContext): Promise<SkippedServer | null> {
  try {
    const reason = await plugin.ready(ctx);
    if (!reason) {
      return null;
    }
    return { name: plugin.name, reason, note: "" };
  } catch (err) {
    return failureOf(plugin.name, err);
  }
}

function loadTools(plugin: Plugin, ctx: PluginContext, existing: ReadonlyMap<string, LiveTool>): LiveTool[] | SkippedServer {
  let listed: Tool[];
  try {
    listed = plugin.tools(ctx);
  } catch (err) {
    return failureOf(plugin.name, err);
  }
  if (!Array.isArray(listed)) {
    return { name: plugin.name, reason: "error", note: "tools() did not return an array" };
  }
  const prefix = sanitizeName(plugin.name);
  const added: LiveTool[] = [];
  const local = new Set<string>();
  for (const tool of listed) {
    let qualified: string;
    try {
      qualified = prefixedName(prefix, tool.name);
    } catch (err) {
      return { name: plugin.name, reason: "error", note: clipNote(errorMessage(err)) };
    }
    if (existing.has(qualified) || local.has(qualified)) {
      return { name: plugin.name, reason: "error", note: clipNote(`tool name collision on ${JSON.stringify(qualified)}`) };
    }
    local.add(qualified);
    added.push({
      server: plugin.name.trim(),
      originalName: tool.name,
      suffix: sanitizeName(tool.name),
      qualified,
      tool,
    });
  }
  return added;
}

function failureOf(name: string, err: unknown): SkippedServer {
  const note = clipNote(errorMessage(err));
  return { name, reason: classifyReason(note), note };
}

function schemaOf(schema: JsonSchema | undefined): JsonSchema {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "object", properties: {} };
  }
  return schema;
}

function normalizeArgs(args: unknown): Record<string, unknown> | null {
  if (args == null) {
    return {};
  }
  if (!isRecord(args)) {
    return null;
  }
  return args;
}

function meaningfulTokens(name: string): Set<string> {
  const out = new Set<string>();
  for (const token of name.toLowerCase().split("_")) {
    if (!token || GENERIC_TOOL_TOKENS.has(token)) {
      continue;
    }
    out.add(token);
  }
  return out;
}

function clipToolNames(names: readonly string[], limit: number): { shown: string[]; extra: string } {
  if (limit < 1 || names.length <= limit) {
    return { shown: [...names], extra: "" };
  }
  return { shown: names.slice(0, limit), extra: ` (+${names.length - limit} more)` };
}

function raceSignal<T>(signal: AbortSignal | undefined, work: Promise<T>): Promise<T> {
  if (!signal) {
    return work;
  }
  if (signal.aborted) {
    return Promise.reject(abortError(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err instanceof Error ? err : new Error(errorMessage(err)));
      },
    );
  });
}

function abortError(signal: AbortSignal | undefined): Error {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }
  return new DOMException("The operation was aborted", "AbortError");
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
