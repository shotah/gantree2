import {
  errorResult,
  jsonResult,
  type CallContext,
  type JsonSchema,
  type Plugin,
  type PluginContext,
  type Tool,
  type ToolResult,
} from "@/harness/core/tools";
import {
  boardsFromResponse,
  clampLimit,
  clientFrom,
  confluenceGetPageRow,
  cqlFromUserQuery,
  errText,
  issueFieldsParam,
  issuesFromAgileResponse,
  issuesFromSearchResponse,
  issueRow,
  mapPool,
  maxBatch,
  pagesFromListResponse,
  searchIssueFields,
  searchPagesFromResponse,
  spacesFromResponse,
  sprintsFromResponse,
  type AtlassianClient,
} from "./client";

export { keys } from "./keys";

const boardTypes = new Set(["scrum", "kanban", "simple"]);
const sprintStates = new Set(["active", "future", "closed"]);

const listBoardsDescription
  = "List Jira boards for planning and standups. Pass optional name or names, project_key or project_keys, and type or types (scrum, kanban, simple). Omit filters for one page of every board. limit defaults to 25 and maxes at 50 per request. A single name, project_key, or type is also accepted. Returns a list.";
const listSprintsDescription
  = "List sprints on one or more Jira boards. Pass board_id or board_ids (required). state or states defaults to active; allow active, future, or closed. limit defaults to 25 and maxes at 50 per board. A single board_id is also accepted. Returns a list.";
const listIssuesDescription
  = "List issues on Jira boards or sprints. Pass board_id or board_ids and/or sprint_id or sprint_ids (at least one required). Optional jql applies to each request. limit defaults to 25 and maxes at 50 per request. A single board_id or sprint_id is also accepted. Returns a list.";
const searchIssuesDescription
  = "Search Jira issues with JQL. Pass jql or queries (required). limit defaults to 25 and maxes at 50 per query. A single jql string is also accepted. Returns a list.";
const getIssuesDescription
  = "Get Jira issues by key. Pass key or keys (required, max 8). Returns summary, status, assignee, type, priority, parent, updated, url, and a trimmed description when present. A single key is also accepted. Returns a list.";
const listSpacesDescription
  = "List Confluence spaces you can read. Pass optional key or keys and optional type (global or personal). Omit filters for one page of spaces. limit defaults to 25 and maxes at 50 per request. A single key is also accepted. Returns a list.";
const listPagesDescription
  = "List Confluence pages in one or more spaces. Pass space_id or space_ids and/or space_key or space_keys (at least one required). Optional title filters by page title. limit defaults to 25 and maxes at 50 per request. A single space_id or space_key is also accepted. Returns a list.";
const searchPagesDescription
  = "Search Confluence pages with CQL or plain text. Pass cql or queries and/or query or queries (at least one required). Plain text becomes a page full-text search. limit defaults to 25 and maxes at 50 per query. A single cql or query string is also accepted. Returns a list.";
const getPagesDescription
  = "Get Confluence pages by id with plain-text body. Pass id or ids (required, max 8). A single id is also accepted. Returns a list.";

function stringProp(description: string): JsonSchema {
  return { type: "string", description };
}

function numberProp(description: string): JsonSchema {
  return { type: "number", description };
}

function stringArray(description: string): JsonSchema {
  return {
    type: "array",
    description,
    items: { type: "string" },
    minItems: 1,
    maxItems: maxBatch,
  };
}

function numberArray(description: string): JsonSchema {
  return {
    type: "array",
    description,
    items: { type: ["number", "string"] },
    minItems: 1,
    maxItems: maxBatch,
  };
}

function objectSchema(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: "object", properties, required };
}

const boardsSchema = objectSchema({
  limit: numberProp("How many boards per request (default 25, max 50)."),
  name: stringProp("Filter boards by name."),
  names: stringArray("Board names to filter (1–8). One request each."),
  project_key: stringProp("Filter boards by Jira project key."),
  project_keys: stringArray("Project keys to filter (1–8). One request each."),
  type: stringProp("Board type: scrum, kanban, or simple."),
  types: stringArray("Board types to filter (1–8). One request each."),
});

const sprintsSchema = objectSchema({
  board_id: numberProp("Jira board id."),
  board_ids: numberArray("Board ids (1–8). One request each."),
  limit: numberProp("How many sprints per board (default 25, max 50)."),
  state: stringProp("Sprint state: active, future, or closed. Defaults to active."),
  states: stringArray("Sprint states (1–8). Combined per board request."),
});

const listIssuesSchema = objectSchema({
  board_id: numberProp("Jira board id."),
  board_ids: numberArray("Board ids (1–8)."),
  sprint_id: numberProp("Jira sprint id."),
  sprint_ids: numberArray("Sprint ids (1–8)."),
  jql: stringProp("Optional JQL applied to each board or sprint request."),
  limit: numberProp("How many issues per request (default 25, max 50)."),
});

const searchSchema = objectSchema({
  jql: stringProp("One JQL query."),
  queries: stringArray("JQL queries (1–8). One request each."),
  limit: numberProp("How many issues per query (default 25, max 50)."),
});

const getIssuesSchema = objectSchema({
  key: stringProp("One issue key, e.g. PROJ-1."),
  keys: stringArray("Issue keys (1–8)."),
});

const listSpacesSchema = objectSchema({
  limit: numberProp("How many spaces per request (default 25, max 50)."),
  key: stringProp("Confluence space key."),
  keys: stringArray("Space keys (1–8)."),
  type: stringProp("Space type: global or personal."),
});

const listPagesSchema = objectSchema({
  limit: numberProp("How many pages per space (default 25, max 50)."),
  space_id: stringProp("Confluence space id."),
  space_ids: stringArray("Space ids (1–8)."),
  space_key: stringProp("Confluence space key."),
  space_keys: stringArray("Space keys (1–8)."),
  title: stringProp("Filter pages by title."),
});

const searchPagesSchema = objectSchema({
  limit: numberProp("How many hits per query (default 25, max 50)."),
  cql: stringProp("One CQL query."),
  queries: stringArray("CQL or text queries (1–8)."),
  query: stringProp("One plain-text or CQL query."),
});

const getPagesSchema = objectSchema({
  id: stringProp("One Confluence page id."),
  ids: stringArray("Page ids (1–8)."),
});

const spaceTypes = new Set(["global", "personal"]);

function trimmedStrings(value: unknown): string[] {
  if (typeof value === "string") {
    const text = value.trim();
    return text === "" ? [] : [text];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const text = item.trim();
    if (text !== "") {
      out.push(text);
    }
  }
  return out;
}

function collectSearchQueries(args: Record<string, unknown>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [
    ...trimmedStrings(args.cql),
    ...trimmedStrings(args.query),
    ...trimmedStrings(args.queries),
  ]) {
    if (seen.has(item)) {
      continue;
    }
    seen.add(item);
    out.push(item);
  }
  return out;
}

function collect(args: Record<string, unknown>, one: string, many: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [...trimmedStrings(args[one]), ...trimmedStrings(args[many])]) {
    if (seen.has(item)) {
      continue;
    }
    seen.add(item);
    out.push(item);
  }
  return out;
}

function parseBoardId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return null;
}

function collectBoardIds(args: Record<string, unknown>): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  const singles = [args.board_id];
  for (const raw of singles) {
    const id = parseBoardId(raw);
    if (id !== null && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  const list = args.board_ids;
  if (Array.isArray(list)) {
    for (const raw of list) {
      const id = parseBoardId(raw);
      if (id !== null && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

function collectSprintIds(args: Record<string, unknown>): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  const id = parseBoardId(args.sprint_id);
  if (id !== null) {
    seen.add(id);
    out.push(id);
  }
  const list = args.sprint_ids;
  if (Array.isArray(list)) {
    for (const raw of list) {
      const parsed = parseBoardId(raw);
      if (parsed !== null && !seen.has(parsed)) {
        seen.add(parsed);
        out.push(parsed);
      }
    }
  }
  return out;
}

function overCap(label: string, count: number, max: number): string | null {
  if (count > max) {
    return `${label} accepts at most ${String(max)}`;
  }
  return null;
}

function argLimit(args: Record<string, unknown>): number {
  const raw = args.limit;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return clampLimit(raw);
  }
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    return clampLimit(Number.parseInt(raw.trim(), 10));
  }
  return clampLimit(0);
}

function client(ctx: PluginContext): AtlassianClient {
  return clientFrom(ctx.env, ctx.fetch);
}

type BoardFilter = {
  name?: string;
  project_key?: string;
  type?: string;
};

function boardFilters(args: Record<string, unknown>): BoardFilter[] | string {
  const names = collect(args, "name", "names");
  const projectKeys = collect(args, "project_key", "project_keys");
  const types = collect(args, "type", "types");
  const capped = overCap("names", names.length, maxBatch)
    ?? overCap("project_keys", projectKeys.length, maxBatch)
    ?? overCap("types", types.length, maxBatch);
  if (capped !== null) {
    return capped;
  }
  for (const type of types) {
    if (!boardTypes.has(type)) {
      return `type must be scrum, kanban, or simple`;
    }
  }
  if (names.length === 0 && projectKeys.length === 0 && types.length === 0) {
    return [{}];
  }
  const nameList = names.length > 0 ? names : [undefined];
  const pkList = projectKeys.length > 0 ? projectKeys : [undefined];
  const typeList = types.length > 0 ? types : [undefined];
  const filters: BoardFilter[] = [];
  for (const name of nameList) {
    for (const project_key of pkList) {
      for (const type of typeList) {
        if (name === undefined && project_key === undefined && type === undefined) {
          continue;
        }
        const row: BoardFilter = {};
        if (name !== undefined) {
          row.name = name;
        }
        if (project_key !== undefined) {
          row.project_key = project_key;
        }
        if (type !== undefined) {
          row.type = type;
        }
        filters.push(row);
      }
    }
  }
  if (filters.length > maxBatch) {
    return `board filters accept at most ${String(maxBatch)} requests`;
  }
  return filters;
}

function filterRow(filter: BoardFilter, error: string): Record<string, unknown> {
  return { ...filter, error };
}

function collectSprintStates(args: Record<string, unknown>): string[] | string {
  const states = collect(args, "state", "states");
  if (states.length === 0) {
    return ["active"];
  }
  const capped = overCap("states", states.length, maxBatch);
  if (capped !== null) {
    return capped;
  }
  for (const state of states) {
    if (!sprintStates.has(state)) {
      return "state must be active, future, or closed";
    }
  }
  return states;
}

async function listBoardsTool(ctx: PluginContext, call: CallContext, args: Record<string, unknown>): Promise<ToolResult> {
  const filters = boardFilters(args);
  if (typeof filters === "string") {
    return errorResult(filters);
  }
  const limit = argLimit(args);
  let clientInstance: AtlassianClient;
  try {
    clientInstance = client(ctx);
  } catch (err) {
    return errorResult(errText(err));
  }
  const rows: Record<string, unknown>[] = [];
  for (const filter of filters) {
    const params: Record<string, string> = {
      startAt: "0",
      maxResults: String(limit),
    };
    if (filter.name) {
      params.name = filter.name;
    }
    if (filter.project_key) {
      params.projectKeyOrId = filter.project_key;
    }
    if (filter.type) {
      params.type = filter.type;
    }
    try {
      const body = await clientInstance.getJson("/rest/agile/1.0/board", params, call.signal);
      rows.push(...boardsFromResponse(body, clientInstance.origin));
    } catch (err) {
      rows.push(filterRow(filter, errText(err)));
    }
  }
  return jsonResult(rows);
}

async function listSprintsTool(ctx: PluginContext, call: CallContext, args: Record<string, unknown>): Promise<ToolResult> {
  const boardIds = collectBoardIds(args);
  const capped = overCap("board_ids", boardIds.length, maxBatch);
  if (capped !== null) {
    return errorResult(capped);
  }
  if (boardIds.length === 0) {
    return errorResult("board_id or board_ids is required");
  }
  const states = collectSprintStates(args);
  if (typeof states === "string") {
    return errorResult(states);
  }
  const limit = argLimit(args);
  let clientInstance: AtlassianClient;
  try {
    clientInstance = client(ctx);
  } catch (err) {
    return errorResult(errText(err));
  }
  const rows: Record<string, unknown>[] = [];
  for (const boardId of boardIds) {
    try {
      const body = await clientInstance.getJson(
        `/rest/agile/1.0/board/${String(boardId)}/sprint`,
        {
          state: states.join(","),
          startAt: "0",
          maxResults: String(limit),
        },
        call.signal,
      );
      rows.push(...sprintsFromResponse(body, boardId));
    } catch (err) {
      rows.push({ board_id: boardId, error: errText(err) });
    }
  }
  return jsonResult(rows);
}

async function listIssuesTool(ctx: PluginContext, call: CallContext, args: Record<string, unknown>): Promise<ToolResult> {
  const boardIds = collectBoardIds(args);
  const sprintIds = collectSprintIds(args);
  const capped = overCap("board_ids", boardIds.length, maxBatch)
    ?? overCap("sprint_ids", sprintIds.length, maxBatch);
  if (capped !== null) {
    return errorResult(capped);
  }
  if (boardIds.length === 0 && sprintIds.length === 0) {
    return errorResult("board_id, board_ids, sprint_id, or sprint_ids is required");
  }
  const jql = typeof args.jql === "string" ? args.jql.trim() : "";
  const limit = argLimit(args);
  let clientInstance: AtlassianClient;
  try {
    clientInstance = client(ctx);
  } catch (err) {
    return errorResult(errText(err));
  }
  const rows: Record<string, unknown>[] = [];
  const params: Record<string, string> = {
    startAt: "0",
    maxResults: String(limit),
    fields: issueFieldsParam,
  };
  if (jql !== "") {
    params.jql = jql;
  }
  for (const boardId of boardIds) {
    try {
      const body = await clientInstance.getJson(
        `/rest/agile/1.0/board/${String(boardId)}/issue`,
        params,
        call.signal,
      );
      rows.push(...issuesFromAgileResponse(body, clientInstance.origin, { board_id: boardId }));
    } catch (err) {
      rows.push({ board_id: boardId, error: errText(err) });
    }
  }
  for (const sprintId of sprintIds) {
    try {
      const body = await clientInstance.getJson(
        `/rest/agile/1.0/sprint/${String(sprintId)}/issue`,
        params,
        call.signal,
      );
      rows.push(...issuesFromAgileResponse(body, clientInstance.origin, { sprint_id: sprintId }));
    } catch (err) {
      rows.push({ sprint_id: sprintId, error: errText(err) });
    }
  }
  return jsonResult(rows);
}

async function searchIssuesTool(ctx: PluginContext, call: CallContext, args: Record<string, unknown>): Promise<ToolResult> {
  const queries = collect(args, "jql", "queries");
  const capped = overCap("queries", queries.length, maxBatch);
  if (capped !== null) {
    return errorResult(capped);
  }
  if (queries.length === 0) {
    return errorResult("jql or queries is required");
  }
  const limit = argLimit(args);
  let clientInstance: AtlassianClient;
  try {
    clientInstance = client(ctx);
  } catch (err) {
    return errorResult(errText(err));
  }
  const rows: Record<string, unknown>[] = [];
  for (const query of queries) {
    try {
      const body = await clientInstance.postJson(
        "/rest/api/3/search/jql",
        { jql: query, maxResults: limit, fields: searchIssueFields },
        call.signal,
      );
      rows.push(...issuesFromSearchResponse(body, clientInstance.origin, query));
    } catch (err) {
      rows.push({ query, error: errText(err) });
    }
  }
  return jsonResult(rows);
}

function collectSpaceIds(args: Record<string, unknown>): string[] {
  return collect(args, "space_id", "space_ids");
}

function collectSpaceKeys(args: Record<string, unknown>): string[] {
  return collect(args, "space_key", "space_keys");
}

function spaceTypeFilter(args: Record<string, unknown>): { type?: string; error?: string } {
  const raw = args.type;
  if (typeof raw !== "string") {
    return {};
  }
  const type = raw.trim();
  if (type === "") {
    return {};
  }
  if (!spaceTypes.has(type)) {
    return { error: "type must be global or personal" };
  }
  return { type };
}

async function listSpacesTool(ctx: PluginContext, call: CallContext, args: Record<string, unknown>): Promise<ToolResult> {
  const keys = collect(args, "key", "keys");
  const capped = overCap("keys", keys.length, maxBatch);
  if (capped !== null) {
    return errorResult(capped);
  }
  const { type: spaceType, error: typeError } = spaceTypeFilter(args);
  if (typeError !== undefined) {
    return errorResult(typeError);
  }
  const limit = argLimit(args);
  let clientInstance: AtlassianClient;
  try {
    clientInstance = client(ctx);
  } catch (err) {
    return errorResult(errText(err));
  }
  const rows: Record<string, unknown>[] = [];
  const baseParams: Record<string, string | readonly string[]> = {
    limit: String(limit),
  };
  if (spaceType !== undefined) {
    baseParams.type = spaceType;
  }

  async function fetchSpaces(params: Record<string, string | readonly string[]>): Promise<Record<string, unknown>[]> {
    const body = await clientInstance.getJson("/wiki/api/v2/spaces", params, call.signal);
    return spacesFromResponse(body, clientInstance.origin);
  }

  if (keys.length === 0) {
    try {
      rows.push(...await fetchSpaces(baseParams));
    } catch (err) {
      rows.push({ error: errText(err) });
    }
    return jsonResult(rows);
  }

  const combinedParams = { ...baseParams, keys };
  try {
    const spaces = await fetchSpaces(combinedParams);
    rows.push(...spaces);
    const found = new Set(spaces.map((space) => (typeof space.key === "string" ? space.key : "")));
    for (const key of keys) {
      if (!found.has(key)) {
        rows.push({ key, error: "space not found" });
      }
    }
  } catch {
    for (const key of keys) {
      try {
        const spaces = await fetchSpaces({ ...baseParams, keys: [key] });
        if (spaces.length === 0) {
          rows.push({ key, error: "space not found" });
        } else {
          rows.push(...spaces);
        }
      } catch (err) {
        rows.push({ key, error: errText(err) });
      }
    }
  }
  return jsonResult(rows);
}

async function resolveSpaceByKey(
  clientInstance: AtlassianClient,
  spaceKey: string,
  signal?: AbortSignal,
): Promise<{ spaceId: string; spaceKey: string } | { spaceKey: string; error: string }> {
  try {
    const body = await clientInstance.getJson(
      "/wiki/api/v2/spaces",
      { keys: [spaceKey], limit: "1" },
      signal,
    );
    const spaces = spacesFromResponse(body, clientInstance.origin);
    const first = spaces[0];
    const spaceId = typeof first?.id === "string" || typeof first?.id === "number" ? String(first.id) : "";
    if (first === undefined || spaceId === "") {
      return { spaceKey, error: "space not found" };
    }
    return { spaceId, spaceKey };
  } catch (err) {
    return { spaceKey, error: errText(err) };
  }
}

async function listPagesForSpace(
  clientInstance: AtlassianClient,
  spaceId: string,
  source: Record<string, unknown>,
  limit: number,
  title: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>[]> {
  const params: Record<string, string> = { limit: String(limit) };
  if (title !== "") {
    params.title = title;
  }
  const body = await clientInstance.getJson(
    `/wiki/api/v2/spaces/${encodeURIComponent(spaceId)}/pages`,
    params,
    signal,
  );
  return pagesFromListResponse(body, clientInstance.origin, source);
}

async function listPagesTool(ctx: PluginContext, call: CallContext, args: Record<string, unknown>): Promise<ToolResult> {
  const spaceIds = collectSpaceIds(args);
  const spaceKeys = collectSpaceKeys(args);
  const capped = overCap("space_ids", spaceIds.length, maxBatch)
    ?? overCap("space_keys", spaceKeys.length, maxBatch);
  if (capped !== null) {
    return errorResult(capped);
  }
  if (spaceIds.length === 0 && spaceKeys.length === 0) {
    return errorResult("space_id, space_ids, space_key, or space_keys is required");
  }
  const title = typeof args.title === "string" ? args.title.trim() : "";
  const limit = argLimit(args);
  let clientInstance: AtlassianClient;
  try {
    clientInstance = client(ctx);
  } catch (err) {
    return errorResult(errText(err));
  }
  const rows: Record<string, unknown>[] = [];

  for (const spaceId of spaceIds) {
    const source = { space_id: spaceId };
    try {
      rows.push(...await listPagesForSpace(clientInstance, spaceId, source, limit, title, call.signal));
    } catch (err) {
      rows.push({ ...source, error: errText(err) });
    }
  }

  for (const spaceKey of spaceKeys) {
    const resolved = await resolveSpaceByKey(clientInstance, spaceKey, call.signal);
    if ("error" in resolved) {
      rows.push({ space_key: resolved.spaceKey, error: resolved.error });
      continue;
    }
    const source = { space_id: resolved.spaceId, space_key: resolved.spaceKey };
    try {
      rows.push(...await listPagesForSpace(clientInstance, resolved.spaceId, source, limit, title, call.signal));
    } catch (err) {
      rows.push({ ...source, error: errText(err) });
    }
  }

  return jsonResult(rows);
}

async function searchPagesTool(ctx: PluginContext, call: CallContext, args: Record<string, unknown>): Promise<ToolResult> {
  const queries = collectSearchQueries(args);
  const capped = overCap("queries", queries.length, maxBatch);
  if (capped !== null) {
    return errorResult(capped);
  }
  if (queries.length === 0) {
    return errorResult("cql, queries, or query is required");
  }
  const limit = argLimit(args);
  let clientInstance: AtlassianClient;
  try {
    clientInstance = client(ctx);
  } catch (err) {
    return errorResult(errText(err));
  }
  const rows: Record<string, unknown>[] = [];
  for (const query of queries) {
    const cql = cqlFromUserQuery(query);
    try {
      const body = await clientInstance.getJson(
        "/wiki/rest/api/search",
        { cql, limit: String(limit), excerpt: "indexed" },
        call.signal,
      );
      rows.push(...searchPagesFromResponse(body, clientInstance.origin, query));
    } catch (err) {
      rows.push({ query, error: errText(err) });
    }
  }
  return jsonResult(rows);
}

async function getPagesTool(ctx: PluginContext, call: CallContext, args: Record<string, unknown>): Promise<ToolResult> {
  const ids = collect(args, "id", "ids");
  const capped = overCap("ids", ids.length, maxBatch);
  if (capped !== null) {
    return errorResult(capped);
  }
  if (ids.length === 0) {
    return errorResult("id or ids is required");
  }
  let clientInstance: AtlassianClient;
  try {
    clientInstance = client(ctx);
  } catch (err) {
    return errorResult(errText(err));
  }
  const parts = await mapPool(ids, async (id) => {
    try {
      const body = await clientInstance.getJson(
        `/wiki/api/v2/pages/${encodeURIComponent(id)}`,
        { "body-format": "atlas_doc_format" },
        call.signal,
      );
      if (body !== null && typeof body === "object" && !Array.isArray(body)) {
        return confluenceGetPageRow(clientInstance.origin, body as Record<string, unknown>);
      }
      return { id, error: "unexpected Confluence response" };
    } catch (err) {
      return { id, error: errText(err) };
    }
  });
  return jsonResult(parts);
}

async function getIssuesTool(ctx: PluginContext, call: CallContext, args: Record<string, unknown>): Promise<ToolResult> {
  const keys = collect(args, "key", "keys");
  const capped = overCap("keys", keys.length, maxBatch);
  if (capped !== null) {
    return errorResult(capped);
  }
  if (keys.length === 0) {
    return errorResult("key or keys is required");
  }
  let clientInstance: AtlassianClient;
  try {
    clientInstance = client(ctx);
  } catch (err) {
    return errorResult(errText(err));
  }
  const fields = `${issueFieldsParam},description`;
  const parts = await mapPool(keys, async (key) => {
    try {
      const body = await clientInstance.getJson(
        `/rest/api/3/issue/${encodeURIComponent(key)}`,
        { fields },
        call.signal,
      );
      if (body !== null && typeof body === "object" && !Array.isArray(body)) {
        return issueRow(clientInstance.origin, body as Record<string, unknown>, {}, true);
      }
      return { key, error: "unexpected Jira response" };
    } catch (err) {
      return { key, error: errText(err) };
    }
  });
  return jsonResult(parts);
}

export const atlassian: Plugin = {
  name: "atlassian",
  ready(ctx) {
    const site = (ctx.env.ATLASSIAN_SITE ?? "").trim();
    const email = (ctx.env.ATLASSIAN_EMAIL ?? "").trim();
    const token = (ctx.env.ATLASSIAN_API_TOKEN ?? "").trim();
    if (site === "" || email === "" || token === "") {
      return Promise.resolve("no_key");
    }
    return Promise.resolve(null);
  },
  tools(ctx) {
    void ctx;
    const listBoards: Tool = {
      name: "jira_list_boards",
      description: listBoardsDescription,
      inputSchema: boardsSchema,
      call(args, call) {
        return listBoardsTool(ctx, call, args);
      },
    };
    const listSprints: Tool = {
      name: "jira_list_sprints",
      description: listSprintsDescription,
      inputSchema: sprintsSchema,
      call(args, call) {
        return listSprintsTool(ctx, call, args);
      },
    };
    const listIssues: Tool = {
      name: "jira_list_issues",
      description: listIssuesDescription,
      inputSchema: listIssuesSchema,
      call(args, call) {
        return listIssuesTool(ctx, call, args);
      },
    };
    const searchIssues: Tool = {
      name: "jira_search_issues",
      description: searchIssuesDescription,
      inputSchema: searchSchema,
      call(args, call) {
        return searchIssuesTool(ctx, call, args);
      },
    };
    const getIssues: Tool = {
      name: "jira_get_issues",
      description: getIssuesDescription,
      inputSchema: getIssuesSchema,
      call(args, call) {
        return getIssuesTool(ctx, call, args);
      },
    };
    const listSpaces: Tool = {
      name: "confluence_list_spaces",
      description: listSpacesDescription,
      inputSchema: listSpacesSchema,
      call(args, call) {
        return listSpacesTool(ctx, call, args);
      },
    };
    const listPages: Tool = {
      name: "confluence_list_pages",
      description: listPagesDescription,
      inputSchema: listPagesSchema,
      call(args, call) {
        return listPagesTool(ctx, call, args);
      },
    };
    const searchPages: Tool = {
      name: "confluence_search_pages",
      description: searchPagesDescription,
      inputSchema: searchPagesSchema,
      call(args, call) {
        return searchPagesTool(ctx, call, args);
      },
    };
    const getPages: Tool = {
      name: "confluence_get_pages",
      description: getPagesDescription,
      inputSchema: getPagesSchema,
      call(args, call) {
        return getPagesTool(ctx, call, args);
      },
    };
    return [listBoards, listSprints, listIssues, searchIssues, getIssues, listSpaces, listPages, searchPages, getPages];
  },
};
