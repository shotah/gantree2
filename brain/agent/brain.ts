/**
 * `createBrain` — the Durable Object facade. Phone frames, alarms, and
 * `/auth` all enter here; the loop itself lives in `loop.ts`.
 *
 * Cron is constructed inside from `deps.sql` (`Store` + `Runner`). The room
 * should not open a second store: `alarm()` is the wake. `brain/cron` stores
 * `user_id` as empty, so a push with no `user_id` is for every mouth the
 * room has seen on an inbound.
 */
import { assemblePersona, filePersona, resolveTimezone, syncKernel, type PersonaPart } from "@/brain/persona";
import { openAims, type AimStore } from "@/brain/aims/store";
import type { AimMemory } from "@/brain/aims/memory";
import { CronTools } from "@/brain/cron/tools";
import { PlannerService, type PlannerOptions } from "@/brain/cron/planner";
import { Runner } from "@/brain/cron/runner";
import { openStore, type Store as CronStore } from "@/brain/cron/store";
import { isSilentReply } from "@/brain/cron/silent";
import { reactEmoji, stripReact } from "@/brain/cron/react";
import { stripWaitTokens } from "@/brain/cron/wait";
import { WaitService, type WaitOptions } from "@/brain/cron/waitctl";
import type { Delivery, JobHandler, JobTurn, MemoryLookup, PushMessage, TalkStore } from "@/brain/cron/types";
import { ExamplesService, type ExamplesOptions } from "@/brain/examples/service";
import { HereStore, type GeoPoint } from "@/brain/here";
import { Consolidator } from "@/brain/memory/consolidate";
import { MemoryStore } from "@/brain/memory/store";
import { memoryTools } from "@/brain/memory/tools";
import { todoBoard } from "@/brain/memory/todo";
import { KIND_INSIGHT, SUBJECT_AIM_PREFIX, SUBJECT_TODO_PREFIX, KIND_FACT, KIND_PREFERENCE, SUBJECT_HOURS } from "@/brain/memory/types";
import { aimTools } from "@/brain/aims/tools";
import { selfNoteTool } from "@/brain/selfnote/tools";
import { graduateVoice } from "@/brain/selfnote/graduate";
import { SelfNoteStore } from "@/brain/selfnote/store";
import { LlmSummarizer } from "@/brain/session/summary";
import { SessionStore } from "@/brain/session/store";
import { agentSession } from "@/brain/session/types";
import { EnableStore } from "@/brain/tools/enable";
import { Registry } from "@/brain/tools/registry";
import { monthlyReadLimit } from "@/brain/plugins/twitter/budget";
import { WatchStore } from "@/brain/watch/store";
import { watchTools } from "@/brain/watch/tools";
import { WATCH_WAKE_MAX_ITEMS } from "@/brain/watch/interval";
import { quietResumeAt } from "@/brain/watch/quiet";
import { WebSearch } from "@/brain/websearch/search";
import type { Brain, BrainDeps } from "@/brain/core/brain";
import type { CallContext, PluginContext } from "@/brain/core/tools";
import type { Emit, Inbound } from "@/brain/core/wire";
import { assemble, standingPersona, type Assembler, type TurnIn } from "./context";
import { DraftStream, emitAims, emitCmds, emitPerf, emitReply, emitReact, emitStatus, emitTodo, emitTyping, framingLogger } from "./frames";
import { allPositive, formatReaction, inPalette, parseReaction, storedAssistantReply, stripHarnessContext, turnSource } from "./judgment";
import { runLoop, TurnCancelled, TurnFailed, type LoopResult } from "./loop";
import { HANDLE_FAILED, MAX_TOOL_ITERS_DEFAULT, SOURCE_REACTION, SOURCE_USER, TOOL_TRACE_COMPACT } from "./notes";
import { PerfRing, ToolStats, perfInput, zeroStats, type TurnStats } from "./perf";
import { commandFields, finishAuth, runSlash, startAuth, type SlashEnv } from "./slash";

const REPLY_MEMORY = 200;

export function createBrain(deps: BrainDeps): Brain {
  const env = deps.env;
  const consolidateMin = Math.max(0, envInt(env, "MEMORY_CONSOLIDATE_MINUTES", 30));
  const maxIters = Math.max(1, envInt(env, "TOOL_MAX_ITERATIONS", MAX_TOOL_ITERS_DEFAULT));
  const watchMax = Math.max(1, envInt(env, "WATCH_MAX", 50));
  const stripFillers = envOn(env, "HISTORY_STRIP_FILLERS", true);
  const streamReplies = envOn(env, "STREAM_REPLIES", true);
  const dynamic = envOn(env, "DYNAMIC_TOOLS", true);
  const toolTrace = envTrace(env.TOOL_TRACE);
  const modelName = (env.LLM_MODEL ?? "").trim();
  const redirectUri = (env.OAUTH_REDIRECT_URI ?? "").trim();
  const force = csv(env.MCP_ENABLE_FORCE);
  const startedAt = deps.clock.now();

  let currentEmit: Emit | null = null;
  const fan: Emit = (frame) => {
    currentEmit?.(frame);
  };
  const log = framingLogger(deps.log, fan, deps.clock);

  const sessions = new SessionStore(deps.sql, deps.clock, log);
  const memory = new MemoryStore(deps.sql, deps.clock, log);
  const here = new HereStore(deps.sql, deps.clock, log);
  let reloadPersona = (): void => {};
  const selfNote = new SelfNoteStore(deps.sql, deps.clock, log, {
    onChange: () => {
      reloadPersona();
    },
  });
  const enable = new EnableStore(deps.sql, deps.clock);
  const watch = new WatchStore(deps.sql, deps.clock, watchMax, log);
  const cronStore = openStore(deps.sql, deps.clock);

  const loc = { zone: deps.clock.zone || "America/Los_Angeles" };
  watch.setQuiet({
    resumeAt(at) {
      try {
        const content = memory.activeByKindSubject(KIND_PREFERENCE, SUBJECT_HOURS)?.content ?? "";
        return quietResumeAt(content, at, loc.zone || "UTC");
      } catch {
        return null;
      }
    },
  });
  watch.setTwitterReadLimit(monthlyReadLimit(env));
  watch.setWakeMax(Math.max(1, envInt(env, "WATCH_WAKE_MAX_ITEMS", WATCH_WAKE_MAX_ITEMS)));
  const plannerOpts: PlannerOptions = {
    store: cronStore,
    zone: loc.zone,
    at: (env.DAILY_PLANNER_AT ?? "").trim() || "07:10",
  };
  const examplesOpts: ExamplesOptions = {
    store: cronStore,
    qty: env.EXAMPLES_QTY === undefined ? "1-2" : env.EXAMPLES_QTY,
    startHour: envInt(env, "EXAMPLES_START_HOUR", 6),
    endHour: envInt(env, "EXAMPLES_END_HOUR", 21),
    zone: loc.zone,
  };
  const waitOpts: WaitOptions = { talk: null, jobs: cronStore, zone: loc.zone };
  const cronOpts = { store: cronStore, zone: loc.zone, memory: undefined as MemoryLookup | undefined, now: () => deps.clock.now() };
  const planner = new PlannerService(plannerOpts);
  const lookup = memoryLookup(memory);
  cronOpts.memory = lookup;
  const cronTools = new CronTools(cronOpts);
  const examples = new ExamplesService(examplesOpts);
  const talk = talkAdapter(sessions);
  waitOpts.talk = talk;
  const wait = new WaitService(waitOpts);
  const consolidator = new Consolidator(memory, deps.provider, deps.clock, log, {
    intervalMs: consolidateMin * 60_000,
    zone: loc.zone,
  });

  const delivery: Delivery = { sessionId: agentSession };
  const aimMemory: AimMemory = {
    listAims: () => memory.listBySubjectPrefix(KIND_INSIGHT, SUBJECT_AIM_PREFIX, 0).map((e) => ({
      subject: e.subject,
      content: e.content,
    })),
    sentence: (area) => memory.activeByKindSubject(KIND_INSIGHT, `${SUBJECT_AIM_PREFIX}${area}`)?.content ?? null,
  };
  const aims = openAims(deps.sql, deps.clock, log, aimMemory);
  const pluginCtx: PluginContext = {
    env,
    sql: deps.sql,
    clock: deps.clock,
    log,
    fetch: deps.fetch,
    tokens: deps.tokens,
  };
  const web = new WebSearch({ env, fetch: deps.fetch });
  const registry = new Registry(deps.plugins, pluginCtx, {
    builtins: [
      ...memoryTools(memory, (area) => {
        aims.forget(area);
      }),
      ...aimTools(aims),
      selfNoteTool(selfNote),
      ...watchTools(watch),
      web.tool(),
      ...cronTools.toCoreTools(delivery),
    ],
    enable,
    forcePrefixes: force,
    dynamicTools: dynamic,
  });
  examplesOpts.tools = () => {
    try {
      return registry.list(registry.indexKeys()).map((def) => ({ name: def.name }));
    } catch {
      return [];
    }
  };

  let personaText = "";
  reloadPersona = () => {
    const parts = personaParts(deps.persona);
    const assembled = assemblePersona(parts, selfNote.read());
    personaText = standingPersona(assembled);
    const tz = resolveTimezone(assembled, (env.CRON_TZ ?? "").trim() || loc.zone);
    loc.zone = tz.name;
    deps.clock.zone = tz.name;
    plannerOpts.zone = tz.name;
    examplesOpts.zone = tz.name;
    waitOpts.zone = tz.name;
    cronOpts.zone = tz.name;
  };
  reloadPersona();

  sessions.withSummarizer(new LlmSummarizer(deps.provider)).withFoldHook((prior, next) => {
    graduateVoice(selfNote, prior, next);
  });

  const perf = new PerfRing(startedAt);
  const toolStats = new ToolStats();
  let warmed = false;
  let seq = 0;
  let aimsJson = "";
  let todoJson = "";
  let sentBoards = false;
  const seen = new Set<string>();
  const replies: { id: string; text: string }[] = [];
  const inflight = new Map<string, AbortController>();
  const tails = new Map<string, Promise<void>>();
  let afterPush: (() => void) | null = null;
  let emitDepth = 0;
  let published: Promise<void> | null = null;
  let statusFrame: { published: string[]; skipped: { name: string; reason: string }[] } | null = null;

  const assembler: Assembler = {
    persona: () => personaText,
    zone: () => loc.zone,
    sessions,
    memory,
    aims,
    here,
    enable,
    registry,
    cron: cronStore,
    now: () => deps.clock.now(),
    stripFillers,
    dynamic,
    force,
  };

  const slashEnv: SlashEnv = {
    sessions,
    memory,
    aims,
    selfNote,
    enable,
    registry,
    consolidator,
    consolidateMinutes: consolidateMin,
    planner,
    examples,
    plugins: deps.plugins,
    pluginCtx,
    provider: deps.provider,
    persona: () => personaText,
    zone: () => loc.zone,
    now: () => deps.clock.now(),
    startedAt,
    model: modelName,
    dynamic,
    turnCount: () => perf.turnCount(),
    formatPerf: () => perf.format(deps.clock.now(), loc.zone),
    formatToolStats: () => toolStats.format(deps.clock.now() - startedAt),
    redirectUri,
  };

  try {
    planner.ensureFor({ sessionId: agentSession });
    examples.ensureFor({ sessionId: agentSession });
  } catch (err) {
    log.warn("planner ensure failed", { err: err instanceof Error ? err.message : String(err) });
  }

  const runner = new Runner({
    store: cronStore,
    log,
    push: (msg) => {
      emitPushes(msg);
      const fn = afterPush;
      afterPush = null;
      fn?.();
    },
    recent: (sessionId, sinceMs) => sessions.userActiveSince(sessionId, sinceMs),
    examplesSkipRecentMs: Math.max(0, envInt(env, "EXAMPLES_SKIP_RECENT_MINUTES", 60)) * 60_000,
    examples: () => examples.buildPingPrompt(),
    memory: lookup,
    talk,
  });
  runner.boot();

  function publishOnce(): Promise<void> {
    published ??= registry.publish().then((frame) => {
      statusFrame = { published: frame.published, skipped: frame.skipped };
    });
    return published;
  }

  function nextId(): string {
    seq += 1;
    return `r${String(deps.clock.now())}-${String(seq)}`;
  }

  function rememberReply(id: string, text: string): void {
    replies.push({ id, text });
    while (replies.length > REPLY_MEMORY) replies.shift();
  }

  function lookupReply(id: string): string {
    for (let i = replies.length - 1; i >= 0; i -= 1) {
      const row = replies[i];
      if (row?.id === id) return row.text;
    }
    return "";
  }

  function publishBoards(emit: Emit, forceSend: boolean): void {
    let rows: { aims?: ReturnType<AimStore["wireFrame"]>["aims"]; links?: ReturnType<AimStore["wireFrame"]>["links"] };
    try {
      const frame = aims.wireFrame(aims.areas(), deps.clock.now());
      rows = { aims: frame.aims ?? [], links: frame.links ?? [] };
    } catch {
      rows = { aims: [], links: [] };
    }
    let todo: ReturnType<typeof todoBoard>;
    try {
      todo = todoBoard(memory.listBySubjectPrefix(KIND_FACT, SUBJECT_TODO_PREFIX, 0), loc.zone);
    } catch {
      todo = [];
    }
    const aj = JSON.stringify(rows);
    const tj = JSON.stringify(todo);
    if (forceSend || !sentBoards || aj !== aimsJson) {
      emitAims(emit, rows.aims ?? [], rows.links ?? []);
      aimsJson = aj;
    }
    if (forceSend || !sentBoards || tj !== todoJson) {
      emitTodo(emit, todo);
      todoJson = tj;
    }
    sentBoards = true;
  }

  function notePerf(emit: Emit | null, source: string, userId: string, stats: TurnStats): void {
    perf.append(deps.clock.now(), source, stats);
    if (!emit) return;
    emitPerf(emit, perfInput(agentSession, source, userId, modelName, stats));
  }

  function emitPushes(msg: PushMessage): void {
    if (!currentEmit) return;
    const userId = jobUser(cronStore, msg.id);
    const targets = userId !== "" ? [userId] : [...seen];
    const photos = msg.photos;
    const sink = currentEmit;
    if (targets.length === 0) {
      emitReply(sink, "push", "", msg.text, photos, msg.id);
      return;
    }
    targets.forEach((uid, i) => {
      const id = targets.length > 1 ? `${msg.id}-${String(i)}` : msg.id;
      emitReply(sink, "push", uid, msg.text, photos, id);
    });
  }

  function enqueue(sessionId: string, work: () => Promise<void>): Promise<void> {
    const prev = tails.get(sessionId) ?? Promise.resolve();
    const run = prev.then(work, work);
    const settled = run.then(() => undefined, () => undefined);
    tails.set(sessionId, settled);
    return run;
  }

  async function execute(
    turn: TurnIn,
    source: string,
    stream: DraftStream | null,
    signal: AbortSignal,
    geo?: CallContext["geo"],
  ): Promise<{ raw: string; shown: string; emoji: string; photos: string[]; stats: TurnStats; cancelled: boolean; failed: boolean }> {
    const cold = !warmed;
    const built = assemble(assembler, turn);
    try {
      const result = await runLoop({
        provider: deps.provider,
        registry,
        enable,
        sessionId: turn.sessionId,
        userId: turn.userId,
        messages: built.messages,
        tools: built.tools,
        stableEnd: built.stableEnd,
        hydration: built.hydration,
        schemas: built.schemas,
        source,
        omitTools: turn.noTools,
        maxIters,
        toolTrace,
        streamReplies: stream != null,
        stream,
        signal,
        now: () => deps.clock.now(),
        model: modelName,
        cold,
        toolStats,
        geo,
      });
      warmed = true;
      return landed(turn, result);
    } catch (err) {
      if (err instanceof TurnCancelled) {
        return { raw: "", shown: "", emoji: "", photos: [], stats: err.stats, cancelled: true, failed: false };
      }
      if (err instanceof TurnFailed) {
        return { raw: "", shown: "", emoji: "", photos: [], stats: err.stats, cancelled: false, failed: true };
      }
      const stats = zeroStats(modelName);
      stats.outcome = "error";
      stats.cold = cold;
      return { raw: "", shown: "", emoji: "", photos: [], stats, cancelled: false, failed: true };
    }
  }

  async function landed(turn: TurnIn, result: LoopResult): Promise<{ raw: string; shown: string; emoji: string; photos: string[]; stats: TurnStats; cancelled: boolean; failed: boolean }> {
    const view = present(result.reply, turn.input, "");
    await sessions.append(
      turn.sessionId,
      { role: "user", content: turn.text },
      { role: "assistant", content: storedAssistantReply(result.reply) },
    );
    try {
      await wait.afterReply({ sessionId: turn.sessionId, userId: turn.userId }, turn.text, result.reply);
    } catch (err) {
      log.warn("wait after reply failed", { err: err instanceof Error ? err.message : String(err) });
    }
    return {
      raw: result.reply,
      shown: view.text,
      emoji: view.emoji,
      photos: result.photos,
      stats: result.stats,
      cancelled: false,
      failed: false,
    };
  }

  async function interactive(frame: Inbound, emit: Emit, text: string, images: string[], geo: GeoPoint | null): Promise<void> {
    const userId = (frame.user_id ?? "").trim();
    if (userId !== "") seen.add(userId);
    const source = turnSource(text);
    if (source === SOURCE_USER || source === SOURCE_REACTION) {
      try {
        await wait.onUserTurn(agentSession);
      } catch (err) {
        log.warn("wait clear failed", { err: err instanceof Error ? err.message : String(err) });
      }
    }
    if (geo) here.remember(agentSession, geo, deps.clock.now());
    delivery.sessionId = agentSession;
    delivery.userId = userId;
    const ac = new AbortController();
    inflight.set(agentSession, ac);
    const turn: TurnIn = {
      sessionId: agentSession,
      userId,
      text,
      images,
      surface: frame.context?.surface ?? "",
      input: frame.context?.input ?? "",
      noTools: false,
    };
    emitTyping(emit, userId);
    const stream = streamReplies ? new DraftStream(emit, userId) : null;
    const replyTo = (frame.id ?? "").trim();
    try {
      const done = await execute(turn, source, stream, ac.signal, geo ? { lat: geo.lat, lon: geo.lon, accuracy: geo.accuracyM } : undefined);
      if (done.cancelled) {
        stream?.discard();
        notePerf(emit, source, userId, done.stats);
        return;
      }
      if (done.failed) {
        stream?.discard();
        emitReply(emit, "reply", userId, HANDLE_FAILED, [], nextId());
        publishBoards(emit, false);
        notePerf(emit, source, userId, done.stats);
        return;
      }
      const view = present(done.raw, turn.input, replyTo);
      const silent = isSilentReply(done.raw);
      if (silent || (view.text.trim() === "" && done.photos.length === 0)) {
        if (stream && stream.didStart && !stream.didReply) stream.discard();
        if (view.emoji !== "" && replyTo !== "") emitReact(emit, userId, view.emoji, replyTo);
      } else if (stream) {
        const id = nextId();
        const wire = stream.finish(view.text, done.photos, id);
        if (wire !== "") rememberReply(id, wire);
        if (view.emoji !== "" && replyTo !== "") emitReact(emit, userId, view.emoji, replyTo);
      } else {
        const id = nextId();
        emitReply(emit, "reply", userId, view.text, done.photos, id);
        rememberReply(id, view.text);
        if (view.emoji !== "" && replyTo !== "") emitReact(emit, userId, view.emoji, replyTo);
      }
      publishBoards(emit, false);
      notePerf(emit, source, userId, done.stats);
    } finally {
      if (inflight.get(agentSession) === ac) inflight.delete(agentSession);
    }
  }

  const onCron: JobHandler = async (turn: JobTurn) => {
    delivery.sessionId = turn.sessionId.trim() || agentSession;
    delivery.userId = "";
    const ac = new AbortController();
    const sessionId = delivery.sessionId;
    const source = turnSource(turn.text);
    const built = await execute({
      sessionId,
      userId: "",
      text: turn.text,
      images: [],
      surface: "",
      input: "",
      noTools: turn.noTools,
    }, source, null, ac.signal);
    for (const url of built.photos) turn.photos.push(url);
    const shown = isSilentReply(built.raw) ? built.raw : built.shown;
    const audible = !built.cancelled && !built.failed && !isSilentReply(built.raw) && (shown.trim() !== "" || built.photos.length > 0);
    const finishPerf = (): void => {
      if (currentEmit) publishBoards(currentEmit, false);
      notePerf(currentEmit, source, "", built.stats);
    };
    if (audible) afterPush = finishPerf;
    else finishPerf();
    if (built.failed) return "";
    return shown;
  };

  async function onWatch(text: string, sessionId: string, userId: string): Promise<{ text: string; photos: string[]; stats: TurnStats; source: string }> {
    delivery.sessionId = sessionId.trim() || agentSession;
    delivery.userId = userId;
    const ac = new AbortController();
    const source = turnSource(text);
    const built = await execute({
      sessionId: delivery.sessionId,
      userId,
      text,
      images: [],
      surface: "",
      input: "",
      noTools: false,
    }, source, null, ac.signal);
    const silent = isSilentReply(built.raw) || built.cancelled || built.failed;
    return { text: silent ? "" : built.shown, photos: silent ? [] : built.photos, stats: built.stats, source };
  }

  function nextWake(): number | null {
    return earliest(cronStore.nextDue(), watch.nextDue(), consolidateAt(consolidator, consolidateMin, deps.clock.now()));
  }

  return {
    async handleInbound(frame, emit) {
      await publishOnce();
      currentEmit = emit;
      emitDepth += 1;
      try {
        await onInbound(frame, emit);
      } finally {
        emitDepth -= 1;
        if (emitDepth === 0) currentEmit = null;
      }
    },
    async alarm(emit) {
      await publishOnce();
      currentEmit = emit;
      try {
        const now = deps.clock.now();
        await runner.fireDue(now, onCron);
        await watch.pollDue(now, (name, args) => registry.callRaw(name, args, {
          userId: "",
          sessionId: agentSession,
        }), async (wake) => {
          const sessionId = wake.sessionId.trim() || agentSession;
          const userId = wake.userId.trim();
          const pushed = await onWatch(wake.text, sessionId, userId);
          if (pushed.text.trim() !== "" || pushed.photos.length > 0) {
            const targets = userId !== "" ? [userId] : [...seen];
            const id = `watch-${String(wake.id)}-${String(now)}`;
            if (targets.length === 0) emitReply(emit, "push", "", pushed.text, pushed.photos, id);
            else {
              targets.forEach((uid, i) => {
                emitReply(emit, "push", uid, pushed.text, pushed.photos, targets.length > 1 ? `${id}-${String(i)}` : id);
              });
            }
          }
          publishBoards(emit, false);
          notePerf(emit, pushed.source, userId, pushed.stats);
        });
        if (consolidateMin > 0) {
          const last = consolidator.lastStatus().at;
          if (last === 0 || now >= last + consolidateMin * 60_000) await consolidator.pass();
        }
      } finally {
        currentEmit = null;
      }
      return nextWake();
    },
    nextAlarm() {
      return nextWake();
    },
    async announce(emit) {
      await publishOnce();
      emitStatus(emit, { kind: "status", published: statusFrame?.published ?? [], skipped: statusFrame?.skipped ?? [] });
      emitCmds(emit);
    },
    authStart(plugin, redirect, state) {
      return startAuth(slashEnv, plugin, redirect, state);
    },
    authFinish(plugin, redirect, code) {
      return finishAuth(slashEnv, plugin, redirect, code);
    },
  };

  async function onInbound(frame: Inbound, emit: Emit): Promise<void> {
    const userId = (frame.user_id ?? "").trim();
    if (userId !== "") seen.add(userId);
    if (frame.kind === "ack") return;
    const geo = geoOf(frame);
    if (frame.kind === "pin") {
      if (geo) here.remember(agentSession, geo, deps.clock.now());
      return;
    }
    if (frame.kind === "react") {
      const emoji = (frame.text ?? "").trim();
      if (emoji === "") return;
      const target = lookupReply((frame.id ?? "").trim());
      const text = formatReaction(emoji.split(/\s+/u).filter((part) => part !== ""), target);
      await enqueue(agentSession, async () => {
        if (await triage(text, userId, emit)) return;
        await interactive(frame, emit, text, [], null);
      });
      return;
    }
    const images = imageUrls(frame);
    const stripped = stripHarnessContext(frame.text ?? "");
    if (stripped === "" && images.length === 0) {
      if (geo) here.remember(agentSession, geo, deps.clock.now());
      return;
    }
    const text = stripped === "" ? "[photo]" : stripped;
    const fields = commandFields(text);
    const cmd = fields[0] ?? "";
    if ((cmd === "/cancel" || cmd === "/stop") && fields.length === 1) {
      const ac = inflight.get(agentSession);
      const line = ac
        ? "cancelled — stopped the in-flight turn (tools that already finished are not undone)"
        : "nothing in progress to cancel";
      ac?.abort();
      emitReply(emit, "reply", userId, line, [], nextId());
      return;
    }
    await enqueue(agentSession, async () => {
      const slash = await runSlash(slashEnv, agentSession, text);
      if (slash != null) {
        emitReply(emit, "reply", userId, slash, [], nextId());
        if (cmd === "/aims" || cmd === "/todo") publishBoards(emit, true);
        return;
      }
      if (await triage(text, userId, emit)) return;
      await interactive(frame, emit, text, images, geo);
    });
  }

  async function triage(text: string, userId: string, emit: Emit): Promise<boolean> {
    const parsed = parseReaction(text);
    if (!parsed || !allPositive(parsed.emojis)) return false;
    if (sessions.talkState(agentSession).waitingForReply) return false;
    await sessions.append(
      agentSession,
      { role: "user", content: text },
      { role: "assistant", content: "[silent]" },
    );
    const stats = zeroStats(modelName);
    stats.outcome = "silent";
    stats.cold = !warmed;
    notePerf(emit, SOURCE_REACTION, userId, stats);
    publishBoards(emit, false);
    return true;
  }
}

function present(reply: string, input: string, replyTo: string): { text: string; emoji: string } {
  if (isSilentReply(reply)) return { text: "", emoji: "" };
  const stripped = stripReact(stripWaitTokens(reply));
  const emoji = reactEmoji(reply);
  if (emoji === "") return { text: stripped, emoji: "" };
  if (input !== "spoken" && inPalette(emoji) && replyTo !== "") return { text: stripped, emoji };
  if (stripped.trim() === "") return { text: emoji, emoji: "" };
  return { text: stripped, emoji: "" };
}

function geoOf(frame: Inbound): GeoPoint | null {
  const g = frame.context?.geo;
  if (!g || !Number.isFinite(g.lat) || !Number.isFinite(g.lon)) return null;
  return { lat: g.lat, lon: g.lon, accuracyM: g.accuracy_m };
}

function imageUrls(frame: Inbound): string[] {
  const out: string[] = [];
  for (const img of frame.images ?? []) {
    const url = img.url.trim();
    if (url !== "") out.push(url);
  }
  return out;
}

function jobUser(store: CronStore, frameId: string): string {
  const match = /^cron-(\d+)-/u.exec(frameId);
  if (!match) return "";
  try {
    return store.get(Number(match[1])).userId.trim();
  } catch {
    return "";
  }
}

function memoryLookup(memory: MemoryStore): MemoryLookup {
  return {
    get(id) {
      try {
        const e = memory.get(id);
        return { id: e.id, kind: e.kind, subject: e.subject, content: e.content, supersededBy: e.supersededBy };
      } catch {
        return null;
      }
    },
    activeByKindSubject(kind, subject) {
      const e = memory.activeByKindSubject(kind, subject);
      if (!e) return null;
      return { id: e.id, kind: e.kind, subject: e.subject, content: e.content, supersededBy: e.supersededBy };
    },
  };
}

function talkAdapter(sessions: SessionStore): TalkStore {
  const map = (id: string) => {
    const st = sessions.talkState(id);
    return {
      lastSpeaker: st.lastSpeaker,
      waitingForReply: st.waitingForReply,
      waitNudges: st.waitNudges,
      waitSetAt: st.waitSetAt === 0 ? null : st.waitSetAt,
    };
  };
  return {
    talkState: (id) => map(id),
    armWait: (id) => {
      sessions.armWait(id);
    },
    clearWait: (id) => {
      sessions.clearWait(id);
    },
    bumpWaitNudge: (id) => {
      sessions.bumpWaitNudge(id);
      return map(id);
    },
  };
}

function personaParts(parts: readonly { name: string; text: string }[]): PersonaPart[] {
  const known = parts.some((p) => p.name === filePersona || p.name === "SOUL.md" || p.name === "RULES.md" || p.name === "USER.md" || p.name === "TOOLS.md");
  if (known) return syncKernel(parts).parts;
  const text = parts.map((p) => p.text.trim()).filter((p) => p !== "").join("\n\n");
  if (text === "") return [];
  return [{ name: filePersona, text }];
}

function consolidateAt(consolidator: Consolidator, minutes: number, now: number): number | null {
  if (minutes <= 0) return null;
  const last = consolidator.lastStatus().at;
  if (last === 0) return now;
  return last + minutes * 60_000;
}

function earliest(...times: (number | null)[]): number | null {
  let best: number | null = null;
  for (const t of times) {
    if (t == null) continue;
    if (best == null || t < best) best = t;
  }
  return best;
}

function envInt(env: Readonly<Record<string, string>>, key: string, fallback: number): number {
  const raw = env[key];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function envOn(env: Readonly<Record<string, string>>, key: string, fallback: boolean): boolean {
  const raw = (env[key] ?? "").trim().toLowerCase();
  if (raw === "") return fallback;
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") return true;
  return fallback;
}

function envTrace(raw: string | undefined): string {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "full" || v === "off") return v;
  return TOOL_TRACE_COMPACT;
}

function csv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").map((p) => p.trim()).filter((p) => p !== "");
}
