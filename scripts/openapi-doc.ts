/**
 * OpenAPI 3.1 document (source). Patches the imported base snapshot; `openapi.ts` stringifies it.
 */

import { OPENAPI_BASE } from "./openapi-base.ts";

const GATE_503_ERROR = `{ error: "no admins: set GANTREE_ADMINS" }`;

const INFO_DESCRIPTION = [
  "This document is the HTTP API of the Vinext Worker.",
  "The harness inside the Agent Durable Object opens no listen port. A turn is a method call inside that object.",
  "The Worker answers these routes. The mailbox is `GET /ws/{slug}` (WebSocket upgrade), answered in `worker/index.ts` before Vinext middleware.",
  "The harness also calls `GET` and `POST` `/api/chat/avatar`, and the backdrop and theme routes, with the room bearer.",
  "This file is written by `npm run openapi` from `scripts/openapi-doc.ts` (patches) and `scripts/openapi-base.ts` (operations); do not edit `docs/openapi.yaml` by hand.",
].join("\n");

type JsonObj = Record<string, unknown>;

function isObj(v: unknown): v is JsonObj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fixNullable(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      fixNullable(item);
    }
    return;
  }
  if (!isObj(node)) {
    return;
  }
  if (node.nullable === true) {
    const t = node.type;
    if (typeof t === "string") {
      node.type = [t, "null"];
    } else if (t === undefined) {
      node.type = ["object", "null"];
    }
    delete node.nullable;
  }
  for (const v of Object.values(node)) {
    fixNullable(v);
  }
}

function components(doc: JsonObj): JsonObj {
  const c = doc.components;
  if (!isObj(c)) {
    throw new Error("components missing");
  }
  return c;
}

function schemas(doc: JsonObj): JsonObj {
  const s = components(doc).schemas;
  if (!isObj(s)) {
    throw new Error("schemas missing");
  }
  return s;
}

function responsesComp(doc: JsonObj): JsonObj {
  const r = components(doc).responses;
  if (!isObj(r)) {
    throw new Error("responses missing");
  }
  return r;
}

function paths(doc: JsonObj): JsonObj {
  const p = doc.paths;
  if (!isObj(p)) {
    throw new Error("paths missing");
  }
  return p;
}

function op(doc: JsonObj, path: string, method: string): JsonObj {
  const item = paths(doc)[path];
  if (!isObj(item)) {
    throw new Error(`path missing: ${path}`);
  }
  const operation = item[method];
  if (!isObj(operation)) {
    throw new Error(`operation missing: ${method} ${path}`);
  }
  return operation;
}

function opResponses(operation: JsonObj): JsonObj {
  const r = operation.responses;
  if (!isObj(r)) {
    const empty: JsonObj = {};
    operation.responses = empty;
    return empty;
  }
  return r;
}

function addRefResponse(operation: JsonObj, code: string, ref: string): void {
  const r = opResponses(operation);
  if (!r[code]) {
    r[code] = { $ref: ref };
  }
}

function setRefResponse(operation: JsonObj, code: string, ref: string): void {
  opResponses(operation)[code] = { $ref: ref };
}

function setResponseDescription(operation: JsonObj, code: string, description: string): void {
  const row = opResponses(operation)[code];
  if (isObj(row)) {
    row.description = description;
  }
}

function addJsonResponse(
  operation: JsonObj,
  code: string,
  description: string,
  schema: JsonObj,
): void {
  const r = opResponses(operation);
  if (r[code]) {
    return;
  }
  r[code] = {
    description,
    content: {
      "application/json": { schema },
    },
  };
}

function addTextResponse(operation: JsonObj, code: string, description: string): void {
  const r = opResponses(operation);
  if (r[code]) {
    return;
  }
  r[code] = {
    description,
    content: {
      "text/plain": { schema: { type: "string" } },
    },
  };
}

function addEmptyResponse(operation: JsonObj, code: string, description: string): void {
  const r = opResponses(operation);
  if (!r[code]) {
    r[code] = { description };
  }
}

function errorSchemaRef(): JsonObj {
  return { $ref: "#/components/schemas/Error" };
}

function patchInfo(doc: JsonObj): void {
  const info = doc.info;
  if (!isObj(info)) {
    return;
  }
  info.description = INFO_DESCRIPTION;
}

function patchSchemasBlock(doc: JsonObj): void {
  const s = schemas(doc);
  s.AllowEntry = {
    type: "object",
    required: ["sub", "email"],
    properties: {
      sub: { type: ["string", "null"] },
      email: { type: ["string", "null"] },
    },
  };
  const userRow = s.UserRow;
  if (isObj(userRow) && isObj(userRow.properties)) {
    userRow.properties.entry = { $ref: "#/components/schemas/AllowEntry" };
  }
  s.AuthFailed502 = {
    type: "object",
    required: ["error"],
    properties: {
      error: { type: "string", const: "auth_failed" },
      message: { type: "string" },
    },
  };
  s.BlobWriteOk = {
    type: "object",
    required: ["ok", "rev", "detail"],
    properties: {
      ok: { type: "boolean", const: true },
      rev: { type: "integer" },
      detail: { type: "string" },
    },
  };
  s.PushTestCounts = {
    type: "object",
    required: ["rows", "ok", "gone", "fail", "statuses"],
    properties: {
      rows: { type: "integer" },
      ok: { type: "integer" },
      gone: { type: "integer" },
      fail: { type: "integer" },
      statuses: { type: "array", items: { type: "integer" } },
    },
  };
  fixNullable(s);
}

function patchComponentResponses(doc: JsonObj): void {
  const r = responsesComp(doc);
  r.Gate503NoAdmins = {
    description: "Gate refusal when no admins are configured (`GANTREE_ADMINS`).",
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["error"],
          properties: {
            error: { type: "string", const: "no admins: set GANTREE_ADMINS" },
          },
        },
      },
    },
  };
  r.SettingsUnavailable503 = {
    description: [
      "Handler `{ error: settings_unavailable }` from the Settings DO;",
      `gate ${GATE_503_ERROR} when middleware refuses first.`,
    ].join(" "),
    content: {
      "application/json": { schema: errorSchemaRef() },
    },
  };
  r.AgentUnavailable503 = {
    description: [
      "Handler `{ error: agent_unavailable }` from `callAgent`;",
      `gate ${GATE_503_ERROR} when middleware refuses first.`,
    ].join(" "),
    content: {
      "application/json": { schema: errorSchemaRef() },
    },
  };
  r.ChatConfig503 = {
    description: "Agent binding missing (`{ error: config }`).",
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["error"],
          properties: { error: { type: "string", const: "config" } },
        },
      },
    },
  };
  r.ChatForbiddenJson = {
    description: "Signed in but not on the room list. Body is still `{ error: unauthorized }` (`lib/chat/deny.ts`).",
    content: {
      "application/json": { schema: errorSchemaRef() },
    },
  };
  r.ChatMedia503 = {
    description: [
      "`{ error: config }` when the Agent binding is missing, or gate",
      "`{ error: \"no admins: set GANTREE_ADMINS\" }` when the door refuses the session.",
    ].join(" "),
    content: {
      "application/json": { schema: errorSchemaRef() },
    },
  };
}

function patchAuthStart502(doc: JsonObj): void {
  const r = opResponses(op(doc, "/api/agents/{slug}/auth/start", "post"));
  const resp = r["502"];
  if (isObj(resp) && isObj(resp.content)) {
    const jsonContent = resp.content["application/json"];
    if (isObj(jsonContent)) {
      jsonContent.schema = { $ref: "#/components/schemas/AuthFailed502" };
    }
  }
}

function patchAuthCatch405(doc: JsonObj): void {
  addTextResponse(op(doc, "/api/auth/catch", "get"), "405", "method (text/plain).");
}

function patchAuthLogout(doc: JsonObj): void {
  const operation = op(doc, "/api/auth/logout", "post");
  addRefResponse(operation, "401", "#/components/responses/UnauthorizedJson");
  addRefResponse(operation, "503", "#/components/responses/Gate503NoAdmins");
}

function patchUsers(doc: JsonObj): void {
  const list = op(doc, "/api/users", "get");
  addRefResponse(list, "401", "#/components/responses/UnauthorizedJson");
  addRefResponse(list, "503", "#/components/responses/Gate503NoAdmins");

  const create = op(doc, "/api/users", "post");
  addRefResponse(create, "401", "#/components/responses/UnauthorizedJson");
  addRefResponse(create, "403", "#/components/responses/ForbiddenJson");
  setResponseDescription(
    create,
    "503",
    [
      "Handler `{ error: settings_unavailable }` when user storage is unavailable;",
      `gate ${GATE_503_ERROR} when middleware refuses first.`,
    ].join(" "),
  );

  const del = op(doc, "/api/users/{entry}", "delete");
  addJsonResponse(del, "400", "bad_entry", errorSchemaRef());
  addRefResponse(del, "401", "#/components/responses/UnauthorizedJson");
  addRefResponse(del, "403", "#/components/responses/ForbiddenJson");
  addRefResponse(del, "503", "#/components/responses/Gate503NoAdmins");
}

function patchAgentsList(doc: JsonObj): void {
  const get = op(doc, "/api/agents", "get");
  addRefResponse(get, "503", "#/components/responses/SettingsUnavailable503");

  const post = op(doc, "/api/agents", "post");
  addJsonResponse(post, "400", "bad_json, bad_slug, bad_name, or bad_tags", errorSchemaRef());
  addRefResponse(post, "401", "#/components/responses/UnauthorizedJson");
  addRefResponse(post, "403", "#/components/responses/ForbiddenJson");
  addRefResponse(post, "503", "#/components/responses/SettingsUnavailable503");
}

function patchAgentSlugRoutes(doc: JsonObj): void {
  const agent503Paths = [
    "/api/agents/{slug}/config",
    "/api/agents/{slug}/self",
    "/api/agents/{slug}/persona",
    "/api/agents/{slug}/status",
    "/api/agents/{slug}/restart",
    "/api/agents/{slug}/log",
    "/api/agents/{slug}/users",
    "/api/agents/{slug}/bearer",
  ];
  const inventoryPaths = ["/api/agents/{slug}", "/api/agents/{slug}/enabled"];
  const allSlugPaths = [...inventoryPaths, ...agent503Paths];

  for (const path of allSlugPaths) {
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const item = paths(doc)[path];
      if (!isObj(item) || !isObj(item[method])) {
        continue;
      }
      const operation = item[method];
      addRefResponse(operation, "401", "#/components/responses/UnauthorizedJson");
      addRefResponse(operation, "403", "#/components/responses/ForbiddenJson");
      const settingsInventory = (inventoryPaths.includes(path) && (method === "get" || method === "delete"))
        || (path === "/api/agents/{slug}/enabled" && method === "post");
      const ref503 = settingsInventory
        ? "#/components/responses/SettingsUnavailable503"
        : "#/components/responses/AgentUnavailable503";
      if (inventoryPaths.includes(path) && !settingsInventory) {
        continue;
      }
      addRefResponse(operation, "503", ref503);
    }
  }

  for (const method of ["get", "delete"]) {
    setRefResponse(
      op(doc, "/api/agents/{slug}", method),
      "503",
      "#/components/responses/SettingsUnavailable503",
    );
  }

  addJsonResponse(op(doc, "/api/agents/{slug}", "get"), "400", "bad_slug", errorSchemaRef());
  addJsonResponse(op(doc, "/api/agents/{slug}", "delete"), "400", "bad_slug", errorSchemaRef());

  addJsonResponse(op(doc, "/api/agents/{slug}/config", "get"), "400", "bad_slug", errorSchemaRef());
  const cfgPatch = op(doc, "/api/agents/{slug}/config", "patch");
  const cfg400 = opResponses(cfgPatch)["400"];
  if (isObj(cfg400)) {
    cfg400.description = "bad_config, bad_persona, or too_long";
  }

  addJsonResponse(op(doc, "/api/agents/{slug}/enabled", "post"), "400", "bad_slug or bad_json", errorSchemaRef());

  for (const path of ["/api/agents/{slug}/self", "/api/agents/{slug}/persona", "/api/agents/{slug}/status", "/api/agents/{slug}/restart", "/api/agents/{slug}/log", "/api/agents/{slug}/users"]) {
    for (const method of ["get", "put", "post", "delete"]) {
      const item = paths(doc)[path];
      if (!isObj(item) || !isObj(item[method])) {
        continue;
      }
      addJsonResponse(item[method], "400", "bad_slug (and route-specific errors)", errorSchemaRef());
    }
  }

  for (const method of ["put", "delete"]) {
    setResponseDescription(
      op(doc, "/api/agents/{slug}/persona", method),
      "400",
      "bad_slug, bad_persona, or too_long",
    );
  }

  const usersPut = op(doc, "/api/agents/{slug}/users", "put");
  addJsonResponse(usersPut, "400", "bad_slug or bad users", errorSchemaRef());
  setResponseDescription(usersPut, "400", "bad_slug or bad users");

  addJsonResponse(op(doc, "/api/agents/{slug}/bearer", "get"), "400", "bad_slug", errorSchemaRef());

  const authStart = op(doc, "/api/agents/{slug}/auth/start", "post");
  addRefResponse(authStart, "401", "#/components/responses/UnauthorizedJson");
  addRefResponse(authStart, "403", "#/components/responses/ForbiddenJson");
}

function patchToolsSamples(doc: JsonObj): void {
  addRefResponse(op(doc, "/api/tools", "get"), "503", "#/components/responses/Gate503NoAdmins");
  const samples = op(doc, "/api/samples", "get");
  addRefResponse(samples, "401", "#/components/responses/UnauthorizedJson");
  addRefResponse(samples, "503", "#/components/responses/SettingsUnavailable503");
}

function blobCacheHeaders(): JsonObj {
  return {
    ETag: { schema: { type: "string" } },
    "X-Chat-Rev": { schema: { type: "string" } },
    "Cache-Control": { schema: { type: "string" } },
  };
}

function blobWrite200(operation: JsonObj): void {
  opResponses(operation)["200"] = {
    description: "Stored revision from the Agent DO.",
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/BlobWriteOk" } },
    },
  };
}

function patchAvatarBackdrop(doc: JsonObj): void {
  for (const path of ["/api/chat/avatar", "/api/chat/backdrop"]) {
    for (const method of ["get", "post", "delete"]) {
      const item = paths(doc)[path];
      if (!isObj(item) || !isObj(item[method])) {
        continue;
      }
      const operation = item[method];
      addRefResponse(operation, "401", "#/components/responses/UnauthorizedJson");
      addRefResponse(operation, "403", "#/components/responses/ChatForbiddenJson");
      addRefResponse(operation, "503", "#/components/responses/ChatMedia503");
    }
  }

  const slugQuery = { $ref: "#/components/parameters/AgentSlugQuery" };
  const ifNoneMatchTemplate = {
    name: "If-None-Match",
    in: "header",
    required: false,
    schema: { type: "string" },
    description: "Blob rev etag; matching tag yields 304.",
  };

  for (const path of ["/api/chat/avatar", "/api/chat/backdrop"]) {
    const get = op(doc, path, "get");
    const params = get.parameters;
    const list: JsonObj[] = Array.isArray(params)
      ? params.filter(isObj)
      : [slugQuery];
    const ifNoneMatch = structuredClone(ifNoneMatchTemplate);
    if (!list.some((p) => p.name === "If-None-Match")) {
      get.parameters = [...list, ifNoneMatch];
    }
    const cacheHeaders = blobCacheHeaders();
    const r200 = opResponses(get)["200"];
    if (isObj(r200)) {
      r200.headers = structuredClone(cacheHeaders);
    }
    addEmptyResponse(get, "304", "Not modified; `ETag`, `X-Chat-Rev`, and `Cache-Control` still set.");
    const r304 = opResponses(get)["304"];
    if (isObj(r304)) {
      r304.headers = structuredClone(cacheHeaders);
    }
    addEmptyResponse(get, "404", "Missing blob (empty body).");

    blobWrite200(op(doc, path, "post"));

    const post = op(doc, path, "post");
    const p400 = opResponses(post)["400"];
    if (isObj(p400)) {
      p400.description = path.includes("avatar")
        ? "bad slug, image too large (max 5MB), image too small, need a JPEG (the console converts PNG/WebP on upload), or upload errors."
        : "bad slug, image too large (max 1.5MB), or upload errors.";
    }

    if (path === "/api/chat/backdrop") {
      opResponses(op(doc, path, "delete"))["200"] = {
        description: "Cleared backdrop (`rev: 0`).",
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/BlobWriteOk" } },
        },
      };
    }
  }

  const avGet = op(doc, "/api/chat/avatar", "get");
  const av400 = opResponses(avGet)["400"];
  if (isObj(av400)) {
    av400.description = "bad slug";
  }
}

function patchTheme(doc: JsonObj): void {
  for (const method of ["get", "post", "delete"]) {
    const operation = op(doc, "/api/chat/theme", method);
    addRefResponse(operation, "401", "#/components/responses/UnauthorizedJson");
    addRefResponse(operation, "403", "#/components/responses/ChatForbiddenJson");
    addRefResponse(operation, "503", "#/components/responses/ChatMedia503");
  }
  const get400 = opResponses(op(doc, "/api/chat/theme", "get"))["400"];
  if (isObj(get400)) {
    get400.description = "bad agent id";
  }
}

function patchPush(doc: JsonObj): void {
  const get = op(doc, "/api/chat/push", "get");
  addRefResponse(get, "401", "#/components/responses/UnauthorizedJson");
  addRefResponse(get, "503", "#/components/responses/Gate503NoAdmins");

  for (const method of ["put", "delete", "post"]) {
    const operation = op(doc, "/api/chat/push", method);
    addRefResponse(operation, "401", "#/components/responses/UnauthorizedJson");
    addRefResponse(operation, "403", "#/components/responses/ChatForbiddenJson");
    addRefResponse(operation, "503", "#/components/responses/ChatMedia503");
  }

  opResponses(op(doc, "/api/chat/push", "put"))["200"] = {
    description: "Subscription stored.",
    content: { "application/json": { schema: { $ref: "#/components/schemas/OkTrue" } } },
  };
  opResponses(op(doc, "/api/chat/push", "delete"))["200"] = {
    description: "Subscription removed.",
    content: { "application/json": { schema: { $ref: "#/components/schemas/OkTrue" } } },
  };
  opResponses(op(doc, "/api/chat/push", "post"))["200"] = {
    description: "Push test delivery counts.",
    content: { "application/json": { schema: { $ref: "#/components/schemas/PushTestCounts" } } },
  };
  addEmptyResponse(op(doc, "/api/chat/push", "post"), "404", "VAPID not configured (empty body).");
}

function patchTts(doc: JsonObj): void {
  for (const method of ["get", "post"]) {
    const operation = op(doc, "/api/chat/tts", method);
    addRefResponse(operation, "401", "#/components/responses/UnauthorizedJson");
    addRefResponse(operation, "503", "#/components/responses/Gate503NoAdmins");
  }
}

function patchWs(doc: JsonObj): void {
  const ws = op(doc, "/ws/{slug}", "get");
  addRefResponse(ws, "503", "#/components/responses/ChatConfig503");
  const r = opResponses(ws);
  if (isObj(r["401"])) {
    r["401"] = {
      description: "Missing or invalid session (JSON `{ error: unauthorized }` before upgrade).",
      content: { "application/json": { schema: errorSchemaRef() } },
    };
  }
  if (isObj(r["403"])) {
    r["403"] = {
      description: "Origin check failure → text/plain `forbidden`; room-list miss → JSON `{ error: unauthorized }`.",
      content: {
        "text/plain": { schema: { type: "string" } },
        "application/json": { schema: errorSchemaRef() },
      },
    };
  }
  if (isObj(r["404"])) {
    r["404"] = {
      description: "not found (text/plain; bad role or slug).",
      content: { "text/plain": { schema: { type: "string" } } },
    };
  }
}

function patchAgentAuthStart503(doc: JsonObj): void {
  setResponseDescription(
    op(doc, "/api/agents/{slug}/auth/start", "post"),
    "503",
    [
      "`no_origin` or login not configured;",
      "handler `{ error: agent_unavailable }` from `callAgent`;",
      `gate ${GATE_503_ERROR} when middleware refuses first.`,
    ].join(" "),
  );
}

export function buildOpenApiDocument(): JsonObj {
  const doc = structuredClone(OPENAPI_BASE) as JsonObj;
  patchInfo(doc);
  patchSchemasBlock(doc);
  patchComponentResponses(doc);
  patchAuthCatch405(doc);
  patchAuthLogout(doc);
  patchUsers(doc);
  patchAgentsList(doc);
  patchAgentSlugRoutes(doc);
  patchAuthStart502(doc);
  patchAgentAuthStart503(doc);
  patchToolsSamples(doc);
  patchAvatarBackdrop(doc);
  patchTheme(doc);
  patchPush(doc);
  patchTts(doc);
  patchWs(doc);
  return doc;
}
