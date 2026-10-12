import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const REPO = join(import.meta.dirname, "../..");
const OPENAPI_PATH = join(REPO, "docs/openapi.yaml");
const API_ROOT = join(REPO, "app/api");

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

type SecurityRequirement = Record<string, string[]>;

type OperationObject = {
  security?: SecurityRequirement[];
};

type PathItem = Partial<Record<HttpMethod, OperationObject>>;

type OpenApiDoc = {
  paths: Record<string, PathItem>;
  components: {
    securitySchemes: Record<string, unknown>;
  };
};

const DEFINED_SCHEMES = new Set(["sessionCookie", "sessionBearer", "roomBearer"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOpenApi(raw: unknown): OpenApiDoc {
  if (!isRecord(raw)) {
    throw new Error("OpenAPI root is not an object");
  }
  const pathsRaw = raw.paths;
  if (!isRecord(pathsRaw)) {
    throw new Error("OpenAPI paths missing");
  }
  const paths: Record<string, PathItem> = {};
  for (const [pathKey, item] of Object.entries(pathsRaw)) {
    if (!isRecord(item)) {
      continue;
    }
    const pathItem: PathItem = {};
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (isRecord(op)) {
        pathItem[method] = { security: readSecurity(op.security) };
      }
    }
    paths[pathKey] = pathItem;
  }
  const componentsRaw = raw.components;
  if (!isRecord(componentsRaw)) {
    throw new Error("OpenAPI components missing");
  }
  const schemesRaw = componentsRaw.securitySchemes;
  if (!isRecord(schemesRaw)) {
    throw new Error("OpenAPI securitySchemes missing");
  }
  return { paths, components: { securitySchemes: schemesRaw } };
}

function readSecurity(raw: unknown): SecurityRequirement[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const out: SecurityRequirement[] = [];
  for (const row of raw) {
    if (!isRecord(row)) {
      continue;
    }
    const req: SecurityRequirement = {};
    for (const [key, scopes] of Object.entries(row)) {
      if (Array.isArray(scopes) && scopes.every((s) => typeof s === "string")) {
        req[key] = scopes;
      }
    }
    out.push(req);
  }
  return out;
}

function listRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) {
      out.push(...listRouteFiles(full));
    } else if (name.isFile() && name.name === "route.ts") {
      out.push(full);
    }
  }
  return out;
}

function apiPathFromFile(file: string): string {
  const rel = relative(API_ROOT, file);
  const dir = rel.replace(/\/route\.ts$/, "");
  const segments = dir.split("/").map((seg) => {
    if (seg.startsWith("[") && seg.endsWith("]")) {
      return `{${seg.slice(1, -1)}}`;
    }
    return seg;
  });
  return `/api/${segments.join("/")}`;
}

const EXPORT_HTTP = [
  { name: "GET", method: "get" },
  { name: "POST", method: "post" },
  { name: "PUT", method: "put" },
  { name: "PATCH", method: "patch" },
  { name: "DELETE", method: "delete" },
] as const satisfies readonly { name: string; method: HttpMethod }[];

function exportedMethods(source: string): HttpMethod[] {
  const found = new Set<HttpMethod>();
  for (const row of EXPORT_HTTP) {
    if (
      source.includes(`export function ${row.name}`)
      || source.includes(`export async function ${row.name}`)
    ) {
      found.add(row.method);
    }
  }
  return [...found];
}

function operation(
  doc: OpenApiDoc,
  path: string,
  method: HttpMethod,
): OperationObject | undefined {
  return doc.paths[path]?.[method];
}

function schemeNames(security: SecurityRequirement[] | undefined): Set<string> {
  const names = new Set<string>();
  if (!security) {
    return names;
  }
  for (const row of security) {
    for (const key of Object.keys(row)) {
      names.add(key);
    }
  }
  return names;
}

function hasScheme(security: SecurityRequirement[] | undefined, scheme: string): boolean {
  return schemeNames(security).has(scheme);
}

function securityIncludesRoomBearer(security: SecurityRequirement[] | undefined): boolean {
  return hasScheme(security, "roomBearer");
}

describe("docs/openapi.yaml", () => {
  const raw = parse(readFileSync(OPENAPI_PATH, "utf8")) as unknown;
  const doc = parseOpenApi(raw);

  it("lists every app/api route method", () => {
    const files = listRouteFiles(API_ROOT);
    const missing: string[] = [];
    for (const file of files) {
      const path = apiPathFromFile(file);
      const source = readFileSync(file, "utf8");
      for (const method of exportedMethods(source)) {
        if (!operation(doc, path, method)) {
          missing.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("documents GET /ws/{slug}", () => {
    expect(operation(doc, "/ws/{slug}", "get")).toBeDefined();
  });

  it("marks listed public auth and health routes", () => {
    const publicPaths: { path: string; method: HttpMethod }[] = [
      { path: "/api/health", method: "get" },
      { path: "/api/auth/google", method: "get" },
      { path: "/api/auth/callback/google", method: "get" },
      { path: "/api/auth/config", method: "get" },
      { path: "/api/auth/nonce", method: "get" },
      { path: "/api/auth/token", method: "post" },
    ];
    for (const { path, method } of publicPaths) {
      const op = operation(doc, path, method);
      expect(op?.security, `${method} ${path}`).toEqual([]);
    }
  });

  it("requires security on non-public operations", () => {
    const publicKeys = new Set(
      [
        "get /api/health",
        "get /api/auth/google",
        "get /api/auth/callback/google",
        "get /api/auth/config",
        "get /api/auth/nonce",
        "post /api/auth/token",
      ],
    );
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const method of HTTP_METHODS) {
        const op = item[method];
        if (!op) {
          continue;
        }
        const key = `${method} ${path}`;
        if (publicKeys.has(key)) {
          continue;
        }
        expect(op.security?.length ?? 0, key).toBeGreaterThan(0);
      }
    }
  });

  it("GET /api/auth/catch is session cookie only", () => {
    const sec = operation(doc, "/api/auth/catch", "get")?.security;
    expect(hasScheme(sec, "sessionCookie")).toBe(true);
    expect(hasScheme(sec, "roomBearer")).toBe(false);
  });

  it("chat media routes accept room bearer and session", () => {
    const routes: { path: string; methods: HttpMethod[] }[] = [
      { path: "/api/chat/avatar", methods: ["get", "post"] },
      { path: "/api/chat/backdrop", methods: ["get", "post", "delete"] },
      { path: "/api/chat/theme", methods: ["get", "post", "delete"] },
    ];
    for (const { path, methods } of routes) {
      for (const method of methods) {
        const sec = operation(doc, path, method)?.security;
        expect(hasScheme(sec, "sessionCookie"), `${method} ${path}`).toBe(true);
        expect(hasScheme(sec, "sessionBearer"), `${method} ${path}`).toBe(true);
        expect(hasScheme(sec, "roomBearer"), `${method} ${path}`).toBe(true);
      }
    }
  });

  it("push and tts do not accept room bearer", () => {
    const blocked: { path: string; methods: HttpMethod[] }[] = [
      { path: "/api/chat/push", methods: ["get", "put", "post", "delete"] },
      { path: "/api/chat/tts", methods: ["get", "post"] },
    ];
    for (const { path, methods } of blocked) {
      for (const method of methods) {
        const sec = operation(doc, path, method)?.security;
        expect(securityIncludesRoomBearer(sec), `${method} ${path}`).toBe(false);
      }
    }
  });

  it("GET /ws/{slug} lists all three schemes", () => {
    const sec = operation(doc, "/ws/{slug}", "get")?.security;
    expect(hasScheme(sec, "sessionCookie")).toBe(true);
    expect(hasScheme(sec, "sessionBearer")).toBe(true);
    expect(hasScheme(sec, "roomBearer")).toBe(true);
  });

  it("uses only defined security scheme names", () => {
    const stray: string[] = [];
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const method of HTTP_METHODS) {
        const op = item[method];
        if (!op?.security) {
          continue;
        }
        for (const name of schemeNames(op.security)) {
          if (!DEFINED_SCHEMES.has(name)) {
            stray.push(`${name} on ${method} ${path}`);
          }
        }
      }
    }
    expect(stray).toEqual([]);
  });

  it("does not document internal agent URLs", () => {
    const bad = Object.keys(doc.paths).filter(
      (p) => p.includes("X-Chat-Op") || p.includes("https://agent"),
    );
    expect(bad).toEqual([]);
  });

  it("defines exactly three security schemes", () => {
    expect(Object.keys(doc.components.securitySchemes).sort()).toEqual(
      ["roomBearer", "sessionBearer", "sessionCookie"].sort(),
    );
  });
});
