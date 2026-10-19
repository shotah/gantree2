export const defaultLimit = 25;
export const maxLimit = 50;
export const maxBatch = 8;
export const fetchPool = 4;

const issueFields = ["summary", "status", "assignee", "issuetype", "priority", "parent", "updated", "labels"] as const;
export const issueFieldsParam = issueFields.join(",");
export const searchIssueFields = [...issueFields];

export class AtlassianHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AtlassianHttpError";
  }
}

export function normalizeSite(raw: string): string {
  let text = raw.trim().replace(/\/+$/, "");
  if (text === "") {
    throw new Error("ATLASSIAN_SITE is required");
  }
  if (!/^https?:\/\//i.test(text)) {
    text = `https://${text}`;
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("ATLASSIAN_SITE is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("ATLASSIAN_SITE must use http or https");
  }
  return url.origin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function errorMessage(body: unknown, status: number): string {
  if (isRecord(body)) {
    const confluenceErrors = body.errors;
    if (Array.isArray(confluenceErrors) && confluenceErrors.length > 0) {
      const parts = confluenceErrors
        .filter(isRecord)
        .map((item) => {
          const title = str(item.title);
          if (title !== "") {
            return title;
          }
          return str(item.detail);
        })
        .filter((item) => item !== "");
      if (parts.length > 0) {
        return parts.join("; ");
      }
    }
    const messages = body.errorMessages;
    if (Array.isArray(messages) && messages.length > 0) {
      const parts = messages.filter((item): item is string => typeof item === "string");
      if (parts.length > 0) {
        return parts.join("; ");
      }
    }
    const errors = body.errors;
    if (isRecord(errors)) {
      const parts = Object.values(errors).filter((item): item is string => typeof item === "string");
      if (parts.length > 0) {
        return parts.join("; ");
      }
    }
    const message = body.message;
    if (typeof message === "string" && message !== "") {
      return message;
    }
  }
  return `Atlassian request failed (${String(status)})`;
}

export type AtlassianQueryParams = Record<string, string | readonly string[]>;

export type AtlassianClient = {
  origin: string;
  getJson(path: string, params: AtlassianQueryParams, signal?: AbortSignal): Promise<unknown>;
  postJson(path: string, body: unknown, signal?: AbortSignal): Promise<unknown>;
};

export function clientFrom(
  env: Readonly<Record<string, string>>,
  fetchFn: typeof fetch,
): AtlassianClient {
  const origin = normalizeSite(env.ATLASSIAN_SITE ?? "");
  const email = (env.ATLASSIAN_EMAIL ?? "").trim();
  const token = (env.ATLASSIAN_API_TOKEN ?? "").trim();
  if (email === "" || token === "") {
    throw new Error("ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN are required");
  }
  const auth = btoa(`${email}:${token}`);
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  async function readResponse(res: Response): Promise<unknown> {
    const text = await res.text();
    let body: unknown = null;
    if (text !== "") {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = text;
      }
    }
    if (!res.ok) {
      throw new AtlassianHttpError(errorMessage(body, res.status), res.status);
    }
    return body;
  }

  return {
    origin,
    getJson(path, params, signal) {
      const url = new URL(path, origin);
      for (const [key, value] of Object.entries(params)) {
        if (Array.isArray(value)) {
          for (const item of value) {
            if (typeof item === "string" && item !== "") {
              url.searchParams.append(key, item);
            }
          }
        } else if (typeof value === "string" && value !== "") {
          url.searchParams.set(key, value);
        }
      }
      return fetchFn(url.toString(), { method: "GET", headers, signal }).then(readResponse);
    },
    postJson(path, body, signal) {
      const url = new URL(path, origin);
      return fetchFn(url.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      }).then(readResponse);
    },
  };
}

export function clampLimit(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) {
    return defaultLimit;
  }
  return Math.min(maxLimit, Math.trunc(raw));
}

function nestedName(obj: Record<string, unknown>, key: string): string | undefined {
  const nested = obj[key];
  if (!isRecord(nested)) {
    return undefined;
  }
  const name = nested.name;
  return typeof name === "string" && name !== "" ? name : undefined;
}

function nestedKey(obj: Record<string, unknown>, key: string): string | undefined {
  const nested = obj[key];
  if (!isRecord(nested)) {
    return undefined;
  }
  const issueKey = nested.key;
  return typeof issueKey === "string" && issueKey !== "" ? issueKey : undefined;
}

export function boardRow(origin: string, board: Record<string, unknown>): Record<string, unknown> {
  const id = board.id;
  const row: Record<string, unknown> = {
    id,
    name: str(board.name),
    type: str(board.type),
  };
  const location = board.location;
  if (isRecord(location)) {
    const projectKey = str(location.projectKey);
    if (projectKey !== "") {
      row.project_key = projectKey;
      if (typeof id === "number" || typeof id === "string") {
        row.url = `${origin}/jira/software/c/projects/${projectKey}/boards/${String(id)}`;
      }
    }
  }
  return row;
}

export function boardsFromResponse(body: unknown, origin: string): Record<string, unknown>[] {
  if (!isRecord(body) || !Array.isArray(body.values)) {
    return [];
  }
  return body.values.filter(isRecord).map((board) => boardRow(origin, board));
}

export function sprintRow(boardId: number, sprint: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {
    board_id: boardId,
    id: sprint.id,
    name: str(sprint.name),
    state: str(sprint.state),
  };
  const start = str(sprint.startDate);
  if (start !== "") {
    row.start = start;
  }
  const end = str(sprint.endDate);
  if (end !== "") {
    row.end = end;
  }
  const goal = str(sprint.goal);
  if (goal !== "") {
    row.goal = goal;
  }
  return row;
}

export function sprintsFromResponse(body: unknown, boardId: number): Record<string, unknown>[] {
  if (!isRecord(body) || !Array.isArray(body.values)) {
    return [];
  }
  return body.values.filter(isRecord).map((sprint) => sprintRow(boardId, sprint));
}

const descriptionCap = 500;
export const confluenceBodyCap = 8000;

export function adfToPlainText(node: unknown): string {
  if (!isRecord(node)) {
    return "";
  }
  if (node.type === "text" && typeof node.text === "string") {
    return node.text;
  }
  const content = node.content;
  if (!Array.isArray(content)) {
    return "";
  }
  return content.map((child) => adfToPlainText(child)).join(" ");
}

function capDescription(text: string): string | undefined {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed === "") {
    return undefined;
  }
  if (trimmed.length <= descriptionCap) {
    return trimmed;
  }
  return trimmed.slice(0, descriptionCap);
}

function descriptionFromFields(fields: Record<string, unknown>): string | undefined {
  const raw = fields.description;
  if (typeof raw === "string") {
    return capDescription(raw);
  }
  if (isRecord(raw)) {
    return capDescription(adfToPlainText(raw));
  }
  return undefined;
}

export function issueRow(
  origin: string,
  issue: Record<string, unknown>,
  source: Record<string, unknown>,
  includeDescription = false,
): Record<string, unknown> {
  const key = str(issue.key);
  const fields = isRecord(issue.fields) ? issue.fields : {};
  const row: Record<string, unknown> = { key, ...source };
  const summary = str(fields.summary);
  if (summary !== "") {
    row.summary = summary;
  }
  const status = nestedName(fields, "status");
  if (status) {
    row.status = status;
  }
  const assigneeField = fields.assignee;
  if (isRecord(assigneeField)) {
    const display = str(assigneeField.displayName);
    if (display !== "") {
      row.assignee = display;
    }
  }
  const type = nestedName(fields, "issuetype");
  if (type) {
    row.type = type;
  }
  const priority = nestedName(fields, "priority");
  if (priority) {
    row.priority = priority;
  }
  const parent = nestedKey(fields, "parent");
  if (parent) {
    row.parent = parent;
  }
  const updated = str(fields.updated);
  if (updated !== "") {
    row.updated = updated;
  }
  const labelsField = fields.labels;
  if (Array.isArray(labelsField) && labelsField.length > 0) {
    const labels = labelsField.filter((item): item is string => typeof item === "string" && item !== "");
    if (labels.length > 0) {
      row.labels = labels;
    }
  }
  if (key !== "") {
    row.url = `${origin}/browse/${key}`;
  }
  if (includeDescription) {
    const description = descriptionFromFields(fields);
    if (description) {
      row.description = description;
    }
  }
  return row;
}

export function issuesFromAgileResponse(
  body: unknown,
  origin: string,
  source: Record<string, unknown>,
): Record<string, unknown>[] {
  if (!isRecord(body) || !Array.isArray(body.issues)) {
    return [];
  }
  return body.issues.filter(isRecord).map((issue) => issueRow(origin, issue, source));
}

export function issuesFromSearchResponse(
  body: unknown,
  origin: string,
  query: string,
): Record<string, unknown>[] {
  if (!isRecord(body) || !Array.isArray(body.issues)) {
    return [];
  }
  return body.issues.filter(isRecord).map((issue) => issueRow(origin, issue, { query }));
}

export function errText(err: unknown): string {
  if (err instanceof AtlassianHttpError) {
    return err.message;
  }
  return err instanceof Error ? err.message : "Jira request failed";
}

export function webuiUrl(origin: string, webui: string): string | undefined {
  if (webui === "") {
    return undefined;
  }
  if (/^https?:\/\//i.test(webui)) {
    return webui;
  }
  if (webui.startsWith("/wiki/")) {
    return `${origin}${webui}`;
  }
  if (webui.startsWith("/")) {
    return `${origin}/wiki${webui}`;
  }
  return undefined;
}

export function spaceRow(origin: string, space: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const id = space.id;
  if (id !== undefined && id !== null && id !== "") {
    row.id = id;
  }
  const key = str(space.key);
  if (key !== "") {
    row.key = key;
  }
  const name = str(space.name);
  if (name !== "") {
    row.name = name;
  }
  const type = str(space.type);
  if (type !== "") {
    row.type = type;
  }
  const status = str(space.status);
  if (status !== "") {
    row.status = status;
  }
  const homepageId = space.homepageId;
  if (homepageId !== undefined && homepageId !== null && homepageId !== "") {
    row.homepage_id = homepageId;
  }
  const links = space._links;
  if (isRecord(links)) {
    const url = webuiUrl(origin, str(links.webui));
    if (url) {
      row.url = url;
    }
  }
  return row;
}

export function spacesFromResponse(body: unknown, origin: string): Record<string, unknown>[] {
  if (!isRecord(body) || !Array.isArray(body.results)) {
    return [];
  }
  return body.results.filter(isRecord).map((space) => spaceRow(origin, space));
}

export function listPageRow(
  origin: string,
  page: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const row: Record<string, unknown> = { ...source };
  const id = page.id;
  if (id !== undefined && id !== null && id !== "") {
    row.id = id;
  }
  const title = str(page.title);
  if (title !== "") {
    row.title = title;
  }
  const status = str(page.status);
  if (status !== "") {
    row.status = status;
  }
  const spaceId = page.spaceId;
  if (spaceId !== undefined && spaceId !== null && spaceId !== "") {
    row.space_id = spaceId;
  }
  const parentId = page.parentId;
  if (parentId !== undefined && parentId !== null && parentId !== "") {
    row.parent_id = parentId;
  }
  const links = page._links;
  if (isRecord(links)) {
    const url = webuiUrl(origin, str(links.webui));
    if (url) {
      row.url = url;
    }
  }
  return row;
}

export function pagesFromListResponse(
  body: unknown,
  origin: string,
  source: Record<string, unknown>,
): Record<string, unknown>[] {
  if (!isRecord(body) || !Array.isArray(body.results)) {
    return [];
  }
  return body.results.filter(isRecord).map((page) => listPageRow(origin, page, source));
}

function escapeCqlText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

export function cqlFromUserQuery(query: string): string {
  if (/[=~]/.test(query)) {
    return query;
  }
  return `type = page AND text ~ "${escapeCqlText(query)}"`;
}

function stripExcerptHtml(html: string): string {
  let text = html.replace(/<[^>]*>/g, " ");
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  text = text.trim().replace(/\s+/g, " ");
  if (text.length > 300) {
    return text.slice(0, 300);
  }
  return text;
}

export function searchPageRow(
  origin: string,
  hit: Record<string, unknown>,
  query: string,
): Record<string, unknown> {
  const row: Record<string, unknown> = { query };
  const title = str(hit.title);
  if (title !== "") {
    row.title = title;
  }
  const excerptRaw = str(hit.excerpt);
  if (excerptRaw !== "") {
    const excerpt = stripExcerptHtml(excerptRaw);
    if (excerpt !== "") {
      row.excerpt = excerpt;
    }
  }
  const urlDirect = str(hit.url);
  if (urlDirect !== "") {
    row.url = urlDirect.startsWith("http") ? urlDirect : webuiUrl(origin, urlDirect) ?? urlDirect;
  }
  const content = hit.content;
  if (isRecord(content)) {
    const contentId = content.id;
    if (contentId !== undefined && contentId !== null && contentId !== "") {
      row.id = contentId;
    }
    const contentType = str(content.type);
    if (contentType !== "") {
      row.type = contentType;
    }
    const space = content.space;
    if (isRecord(space)) {
      const spaceKey = str(space.key);
      if (spaceKey !== "") {
        row.space_key = spaceKey;
      }
    }
    const links = content._links;
    if (isRecord(links) && row.url === undefined) {
      const url = webuiUrl(origin, str(links.webui));
      if (url) {
        row.url = url;
      }
    }
  }
  const spaceTop = hit.space;
  if (isRecord(spaceTop) && row.space_key === undefined) {
    const spaceKey = str(spaceTop.key);
    if (spaceKey !== "") {
      row.space_key = spaceKey;
    }
  }
  const container = hit.resultGlobalContainer;
  if (isRecord(container)) {
    const spaceName = str(container.title);
    if (spaceName !== "") {
      row.space_name = spaceName;
    }
  }
  const lastModified = str(hit.lastModified);
  if (lastModified !== "") {
    row.updated = lastModified;
  }
  return row;
}

export function searchPagesFromResponse(
  body: unknown,
  origin: string,
  query: string,
): Record<string, unknown>[] {
  if (!isRecord(body) || !Array.isArray(body.results)) {
    return [];
  }
  return body.results.filter(isRecord).map((hit) => searchPageRow(origin, hit, query));
}

export function confluenceBodyFromAtlas(value: unknown): string | undefined {
  let doc: unknown = value;
  if (typeof value === "string") {
    try {
      doc = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!isRecord(doc)) {
    return undefined;
  }
  const text = adfToPlainText(doc).trim().replace(/\s+/g, " ");
  if (text === "") {
    return undefined;
  }
  if (text.length > confluenceBodyCap) {
    return text.slice(0, confluenceBodyCap);
  }
  return text;
}

export function confluenceGetPageRow(origin: string, page: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const id = page.id;
  if (id !== undefined && id !== null && id !== "") {
    row.id = id;
  }
  const title = str(page.title);
  if (title !== "") {
    row.title = title;
  }
  const spaceId = page.spaceId;
  if (spaceId !== undefined && spaceId !== null && spaceId !== "") {
    row.space_id = spaceId;
  }
  const status = str(page.status);
  if (status !== "") {
    row.status = status;
  }
  const links = page._links;
  if (isRecord(links)) {
    const url = webuiUrl(origin, str(links.webui));
    if (url) {
      row.url = url;
    }
  }
  const bodyField = page.body;
  if (isRecord(bodyField)) {
    const atlas = bodyField.atlas_doc_format;
    if (isRecord(atlas)) {
      const body = confluenceBodyFromAtlas(atlas.value);
      if (body) {
        row.body = body;
      }
    }
  }
  return row;
}

export async function mapPool<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Math.min(fetchPool, items.length);
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) {
        return;
      }
      out[index] = await fn(item);
    }
  }
  if (workers === 0) {
    return out;
  }
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}
