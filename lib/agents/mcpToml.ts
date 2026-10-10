/**
 * `mcp.toml` ↔ grants.
 *
 * Subset: `[[server]]` array-of-tables, `#` comments (full line and
 * end-of-line, including inside arrays), basic `"..."` strings (escapes
 * `\\ \" \n \r \t \b \f` and any other `\x` kept as `x`), literal `'...'`
 * strings, string arrays (one line or many, trailing commas), and booleans
 * / bare words kept as raw text. Not inline tables.
 *
 * `env` is a TOML string array, the harness `[]string` of `KEY=VALUE`
 * entries appended to the process env — not a table and not bare key names.
 *
 * `tomlFromGrants` rewrites `name`, `command`, `args`, and `env` to match
 * `grants`. Everything else in `previous` stays: text before the first
 * server, and per-server keys the grant does not own (`auth_args`,
 * `download_url`, `home_only`, …). Servers already in the file keep file
 * order; a grant that is new is appended. Dropping a grant drops its block
 * (from its `[[server]]` header through the line before the next one).
 */
import type { Grant } from "./types";

const MANAGED = new Set(["name", "command", "args", "env"]);

type Field = { type: "field"; key: string; text: string; value: string };
type Chunk = { type: "chunk"; text: string };
type Piece = Field | Chunk;

type ServerBlock = { lead: string; header: string; body: string; name: string | null };

type TextLine = { text: string; sep: string };

function newlineLen(text: string, i: number): number {
  if (text[i] === "\r" && text[i + 1] === "\n") {
    return 2;
  }
  if (text[i] === "\n" || text[i] === "\r") {
    return 1;
  }
  return 0;
}

function quote(value: string): string {
  let out = "\"";
  for (const ch of value) {
    switch (ch) {
      case "\\":
        out += "\\\\";
        break;
      case "\"":
        out += "\\\"";
        break;
      case "\n":
        out += "\\n";
        break;
      case "\r":
        out += "\\r";
        break;
      case "\t":
        out += "\\t";
        break;
      case "\b":
        out += "\\b";
        break;
      case "\f":
        out += "\\f";
        break;
      default:
        out += ch;
        break;
    }
  }
  return `${out}"`;
}

function assignment(key: string, value: string | readonly string[]): string {
  if (typeof value === "string") {
    return `${key} = ${quote(value)}`;
  }
  return `${key} = [${value.map((item) => quote(item)).join(", ")}]`;
}

function scanBasicString(text: string, i: number): number {
  i += 1;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === "\"") {
      return i + 1;
    }
    i += 1;
  }
  return text.length;
}

function scanLiteralString(text: string, i: number): number {
  i += 1;
  while (i < text.length && text[i] !== "'") {
    i += 1;
  }
  return i < text.length ? i + 1 : text.length;
}

function scanBracket(text: string, i: number, open: string, close: string): number {
  let depth = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\"") {
      i = scanBasicString(text, i);
      continue;
    }
    if (ch === "'") {
      i = scanLiteralString(text, i);
      continue;
    }
    if (ch === "#") {
      while (i < text.length && newlineLen(text, i) === 0) {
        i += 1;
      }
      continue;
    }
    if (ch === open) {
      depth += 1;
    } else if (ch === close) {
      depth -= 1;
      i += 1;
      if (depth === 0) {
        return i;
      }
      continue;
    }
    i += 1;
  }
  return text.length;
}

function scanValue(text: string, i: number): number {
  const ch = text[i];
  if (ch === "\"") {
    return scanBasicString(text, i);
  }
  if (ch === "'") {
    return scanLiteralString(text, i);
  }
  if (ch === "[") {
    return scanBracket(text, i, "[", "]");
  }
  if (ch === "{") {
    return scanBracket(text, i, "{", "}");
  }
  while (i < text.length && !/[\s#,\]}]/.test(text[i] ?? "")) {
    i += 1;
  }
  return i;
}

function unescapeBasic(body: string): string {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "\\") {
      out += body[i];
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) {
      out += "\\";
      break;
    }
    i += 1;
    switch (next) {
      case "n":
        out += "\n";
        break;
      case "t":
        out += "\t";
        break;
      case "r":
        out += "\r";
        break;
      case "\\":
        out += "\\";
        break;
      case "\"":
        out += "\"";
        break;
      case "b":
        out += "\b";
        break;
      case "f":
        out += "\f";
        break;
      default:
        out += next;
        break;
    }
  }
  return out;
}

function parseString(raw: string): string | null {
  const text = raw.trim();
  if (text.startsWith("\"")) {
    const end = scanBasicString(text, 0);
    if (end !== text.length || text[end - 1] !== "\"") {
      return null;
    }
    return unescapeBasic(text.slice(1, end - 1));
  }
  if (text.startsWith("'")) {
    const end = scanLiteralString(text, 0);
    if (end !== text.length || text[end - 1] !== "'") {
      return null;
    }
    return text.slice(1, end - 1);
  }
  return null;
}

function skipWsAndComments(text: string, i: number): number {
  while (i < text.length) {
    const nl = newlineLen(text, i);
    if (nl) {
      i += nl;
      continue;
    }
    if (text[i] === " " || text[i] === "\t") {
      i += 1;
      continue;
    }
    if (text[i] === "#") {
      while (i < text.length && newlineLen(text, i) === 0) {
        i += 1;
      }
      continue;
    }
    break;
  }
  return i;
}

function parseStringArray(raw: string): string[] | null {
  const text = raw.trim();
  if (!text.startsWith("[")) {
    return null;
  }
  const end = scanBracket(text, 0, "[", "]");
  if (end !== text.length || text[end - 1] !== "]") {
    return null;
  }
  const inner = text.slice(1, end - 1);
  const out: string[] = [];
  let i = 0;
  while (i < inner.length) {
    i = skipWsAndComments(inner, i);
    if (i >= inner.length) {
      break;
    }
    const valueEnd = scanValue(inner, i);
    if (valueEnd === i) {
      return null;
    }
    const parsed = parseString(inner.slice(i, valueEnd));
    if (parsed === null) {
      return null;
    }
    out.push(parsed);
    i = skipWsAndComments(inner, valueEnd);
    if (i < inner.length && inner[i] === ",") {
      i += 1;
    } else if (i < inner.length) {
      return null;
    }
  }
  return out;
}

function atLineStart(text: string, i: number): boolean {
  return i === 0 || text[i - 1] === "\n" || text[i - 1] === "\r";
}

function matchKey(text: string, i: number): { name: string; valueStart: number } | null {
  const matched = /^[ \t]*([A-Za-z0-9_-]+)[ \t]*=[ \t]*/.exec(text.slice(i));
  if (!matched) {
    return null;
  }
  return { name: matched[1] ?? "", valueStart: i + matched[0].length };
}

function tokenize(body: string): Piece[] {
  const pieces: Piece[] = [];
  let i = 0;
  while (i < body.length) {
    if (atLineStart(body, i)) {
      const key = matchKey(body, i);
      if (key) {
        const valueEnd = scanValue(body, key.valueStart);
        let end = valueEnd;
        while (end < body.length && (body[end] === " " || body[end] === "\t")) {
          end += 1;
        }
        if (body[end] === "#") {
          while (end < body.length && newlineLen(body, end) === 0) {
            end += 1;
          }
        }
        end += newlineLen(body, end);
        pieces.push({
          type: "field",
          key: key.name,
          text: body.slice(i, end),
          value: body.slice(key.valueStart, valueEnd),
        });
        i = end;
        continue;
      }
    }
    let end = i;
    while (end < body.length && newlineLen(body, end) === 0) {
      end += 1;
    }
    end += newlineLen(body, end);
    pieces.push({ type: "chunk", text: body.slice(i, end) });
    i = end;
  }
  return pieces;
}

function readGrant(body: string): Grant | null {
  let name: string | undefined;
  let command: string | undefined;
  let args: string[] | undefined;
  let env: string[] | undefined;
  for (const piece of tokenize(body)) {
    if (piece.type !== "field") {
      continue;
    }
    if (piece.key === "name") {
      const value = parseString(piece.value);
      if (value !== null) {
        name = value.trim();
      }
    } else if (piece.key === "command") {
      const value = parseString(piece.value);
      if (value !== null) {
        command = value.trim();
      }
    } else if (piece.key === "args") {
      const value = parseStringArray(piece.value);
      if (value !== null) {
        args = value;
      }
    } else if (piece.key === "env") {
      const value = parseStringArray(piece.value);
      if (value !== null) {
        env = value;
      }
    }
  }
  if (!name || !command) {
    return null;
  }
  const grant: Grant = { name, command };
  if (args !== undefined) {
    grant.args = args;
  }
  if (env !== undefined) {
    grant.env = env;
  }
  return grant;
}

function readName(body: string): string | null {
  let name: string | null = null;
  for (const piece of tokenize(body)) {
    if (piece.type === "field" && piece.key === "name") {
      const value = parseString(piece.value);
      if (value !== null && value.trim()) {
        name = value.trim();
      }
    }
  }
  return name;
}

function isServerHeader(line: string): boolean {
  return /^[ \t]*\[\[server\]\][ \t]*(?:#.*)?$/.test(line);
}

function textLines(body: string): TextLine[] {
  const parts = body.split(/(\r\n|\n|\r)/);
  const lines: TextLine[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    lines.push({ text: parts[i] ?? "", sep: parts[i + 1] ?? "" });
  }
  const last = lines[lines.length - 1];
  if (last && last.text === "" && last.sep === "") {
    lines.pop();
  }
  return lines;
}

function joinLines(lines: readonly TextLine[]): string {
  return lines.map((line) => line.text + line.sep).join("");
}

/** Trailing blank and `#` lines sit outside the server: they introduce the next one. */
function peelTrailingNotes(body: string): { body: string; lead: string } {
  const lines = textLines(body);
  let cut = lines.length;
  while (cut > 0) {
    const text = (lines[cut - 1]?.text ?? "").trim();
    if (text === "" || text.startsWith("#")) {
      cut -= 1;
      continue;
    }
    break;
  }
  return { body: joinLines(lines.slice(0, cut)), lead: joinLines(lines.slice(cut)) };
}

function splitDocument(toml: string): { preamble: string; blocks: ServerBlock[]; epilogue: string } {
  const headers: { lineStart: number; after: number }[] = [];
  let i = 0;
  while (i <= toml.length) {
    const lineStart = i;
    let lineEnd = i;
    while (lineEnd < toml.length && newlineLen(toml, lineEnd) === 0) {
      lineEnd += 1;
    }
    if (isServerHeader(toml.slice(lineStart, lineEnd))) {
      headers.push({ lineStart, after: lineEnd + newlineLen(toml, lineEnd) });
    }
    if (lineEnd >= toml.length) {
      break;
    }
    i = lineEnd + newlineLen(toml, lineEnd);
  }
  if (headers.length === 0) {
    return { preamble: toml, blocks: [], epilogue: "" };
  }
  const blocks: ServerBlock[] = [];
  let lead = "";
  for (const [h, header] of headers.entries()) {
    const next = headers[h + 1];
    const between = toml.slice(header.after, next ? next.lineStart : toml.length);
    const peeled = peelTrailingNotes(between);
    blocks.push({
      lead,
      header: toml.slice(header.lineStart, header.after),
      body: peeled.body,
      name: readName(peeled.body),
    });
    lead = peeled.lead;
  }
  return { preamble: toml.slice(0, headers[0]?.lineStart ?? 0), blocks, epilogue: lead };
}

function withEnding(line: string, original: string): string {
  if (original.endsWith("\r\n")) {
    return `${line}\r\n`;
  }
  if (original.endsWith("\n")) {
    return `${line}\n`;
  }
  return line;
}

function rewriteBody(body: string, grant: Grant): string {
  const want = new Map<string, string>();
  want.set("name", assignment("name", grant.name));
  want.set("command", assignment("command", grant.command));
  if (grant.args !== undefined) {
    want.set("args", assignment("args", grant.args));
  }
  if (grant.env !== undefined) {
    want.set("env", assignment("env", grant.env));
  }
  const seen = new Set<string>();
  const out: string[] = [];
  let lastField = -1;
  for (const piece of tokenize(body)) {
    if (piece.type === "chunk") {
      out.push(piece.text);
      continue;
    }
    if (!MANAGED.has(piece.key)) {
      out.push(piece.text);
      lastField = out.length - 1;
      continue;
    }
    if (seen.has(piece.key) || !want.has(piece.key)) {
      continue;
    }
    seen.add(piece.key);
    out.push(withEnding(want.get(piece.key) ?? "", piece.text));
    lastField = out.length - 1;
  }
  const missing = [...want.keys()].filter((key) => !seen.has(key));
  if (missing.length > 0) {
    const lines = missing.map((key) => `${want.get(key) ?? ""}\n`).join("");
    const at = lastField + 1;
    const prev = at > 0 ? (out[at - 1] ?? "") : "";
    const pad = prev.length > 0 && !prev.endsWith("\n") ? "\n" : "";
    out.splice(at, 0, pad + lines);
  }
  return out.join("");
}

function freshBlock(grant: Grant): string {
  return `[[server]]\n${rewriteBody("", grant)}`;
}

function usableGrants(grants: readonly Grant[]): Grant[] {
  const out: Grant[] = [];
  const at = new Map<string, number>();
  for (const grant of grants) {
    const name = grant.name.trim();
    const command = grant.command.trim();
    if (!name || !command) {
      continue;
    }
    const next: Grant = { name, command };
    if (grant.args !== undefined) {
      next.args = grant.args;
    }
    if (grant.env !== undefined) {
      next.env = grant.env;
    }
    const index = at.get(name);
    if (index === undefined) {
      at.set(name, out.length);
      out.push(next);
    } else {
      out[index] = next;
    }
  }
  return out;
}

function canonicalDocument(grants: readonly Grant[]): string {
  if (grants.length === 0) {
    return "";
  }
  return grants.map((grant) => freshBlock(grant)).join("\n");
}

type Part = { text: string; fresh: boolean };

function joinParts(preamble: string, parts: Part[]): string {
  if (parts.length === 0) {
    return preamble;
  }
  let out = preamble;
  for (const part of parts) {
    if (part.fresh && out.length > 0) {
      if (!out.endsWith("\n")) {
        out += "\n";
      }
      if (!out.endsWith("\n\n")) {
        out += "\n";
      }
    } else if (out.length > 0 && !out.endsWith("\n") && !part.text.startsWith("\n")) {
      out += "\n";
    }
    out += part.text;
  }
  if (out.length > 0 && !out.endsWith("\n")) {
    out += "\n";
  }
  return out;
}

export function grantsFromToml(toml: string): Grant[] {
  const grants: Grant[] = [];
  for (const block of splitDocument(toml).blocks) {
    const grant = readGrant(block.body);
    if (grant) {
      grants.push(grant);
    }
  }
  return grants;
}

export function tomlFromGrants(grants: readonly Grant[], previous = ""): string {
  const clean = usableGrants(grants);
  if (previous === "") {
    return canonicalDocument(clean);
  }
  const { preamble, blocks, epilogue } = splitDocument(previous);
  const byName = new Map(clean.map((grant) => [grant.name, grant]));
  const emitted = new Set<string>();
  const parts: Part[] = [];
  for (const block of blocks) {
    if (!block.name) {
      parts.push({ text: block.lead + block.header + block.body, fresh: false });
      continue;
    }
    const grant = byName.get(block.name);
    if (!grant || emitted.has(block.name)) {
      if (block.lead) {
        parts.push({ text: block.lead, fresh: false });
      }
      continue;
    }
    emitted.add(block.name);
    parts.push({ text: block.lead + block.header + rewriteBody(block.body, grant), fresh: false });
  }
  if (epilogue) {
    parts.push({ text: epilogue, fresh: false });
  }
  for (const grant of clean) {
    if (!emitted.has(grant.name)) {
      parts.push({ text: freshBlock(grant), fresh: true });
    }
  }
  return joinParts(preamble, parts);
}
