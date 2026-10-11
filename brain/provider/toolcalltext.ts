import type { ToolCall } from "@/brain/core/provider";

/**
 * Ids stay unique within the isolate: a tool result must echo the id of the
 * call it answers. Starts at 1, matching the Go atomic counter.
 */
let textCallSeq = 0;

function nextTextCallId(): string {
  textCallSeq += 1;
  return `call_text_${textCallSeq}`;
}

const WRAPPER = /```[a-zA-Z]*|```|<\/?tool_call>|<\/?function_call>/g;
const PREFIXED = /[A-Za-z][A-Za-z0-9_]*__[A-Za-z0-9_]+/g;

function stripWrappers(content: string): string {
  return content.replace(WRAPPER, "");
}

/** Unique `server__tool` identifiers found in `s`, in order. */
export function prefixedToolNames(text: string): string[] {
  const raw = text.match(PREFIXED);
  if (!raw) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of raw) {
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Recover a tool call the model wrote as text instead of `tool_calls`.
 * Small local models do this routinely, and it is the only channel under a
 * `response_format` grammar, which makes Ollama omit `tool_calls` entirely.
 */
export function parseToolCallText(content: string): ToolCall | undefined {
  return parseToolCallTextHinted(content, []);
}

/** `parseToolCallText` plus optional tool-name hints from the prior turn. */
export function parseToolCallTextHinted(content: string, hintNames: string[]): ToolCall | undefined {
  const stripped = stripWrappers(content);
  return parseJSONToolCall(stripped) ?? parseFnStyleToolCall(stripped) ?? parseArgsOnlyToolCall(stripped, hintNames);
}

function parseJSONToolCall(content: string): ToolCall | undefined {
  const obj = firstJSONObject(content);
  if (obj === undefined) {
    return undefined;
  }
  const fields = parseObject(obj);
  if (!fields) {
    return undefined;
  }
  const name = firstString(fields, ["name", "tool", "tool_name", "function"]);
  if (name === "") {
    return undefined;
  }
  return {
    id: nextTextCallId(),
    name,
    arguments: firstObject(fields, ["arguments", "parameters", "args", "input"]),
  };
}

/**
 * A fenced or bare JSON object of arguments when the tool name is nearby
 * (or uniquely hinted).
 */
function parseArgsOnlyToolCall(content: string, hintNames: string[]): ToolCall | undefined {
  const obj = firstJSONObject(content);
  if (obj === undefined) {
    return undefined;
  }
  const fields = parseObject(obj);
  if (!fields || Object.keys(fields).length === 0) {
    return undefined;
  }
  if (firstString(fields, ["name", "tool", "tool_name", "function"]) !== "") {
    return undefined;
  }
  let args = obj;
  const inner = firstObject(fields, ["arguments", "parameters", "args", "input"]);
  if (inner !== "{}") {
    let onlyWrapper = true;
    for (const key of Object.keys(fields)) {
      if (key !== "arguments" && key !== "parameters" && key !== "args" && key !== "input") {
        onlyWrapper = false;
      }
    }
    if (onlyWrapper) {
      args = inner;
    }
  }
  let name = "";
  const inContent = prefixedToolNames(content);
  if (inContent.length === 1) {
    name = inContent[0] ?? "";
  } else if (inContent.length === 0) {
    const hints = uniqueNonEmpty(hintNames);
    if (hints.length === 1) {
      name = hints[0] ?? "";
    }
  }
  if (name === "" || !name.includes("__")) {
    return undefined;
  }
  if (!mostlyToolArgDump(content, obj, name)) {
    return undefined;
  }
  return { id: nextTextCallId(), name, arguments: args };
}

function uniqueNonEmpty(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (name === "" || seen.has(name)) {
      continue;
    }
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * The message must be little more than the tool name plus the JSON args,
 * not a real answer that happens to mention a tool.
 */
function mostlyToolArgDump(content: string, obj: string, name: string): boolean {
  let rest = content.replace(obj, "");
  rest = rest.replaceAll(name, "");
  rest = stripWrappers(rest).trim();
  let letters = 0;
  let words = 0;
  let inWord = false;
  for (const ch of rest) {
    if (isLetter(ch) || isDigit(ch)) {
      letters += 1;
      if (!inWord) {
        words += 1;
        inWord = true;
      }
      continue;
    }
    inWord = false;
  }
  return letters <= 24 && words <= 3;
}

/** `{server__tool(k="v", …)}` / `server__tool(…)`. */
function parseFnStyleToolCall(content: string): ToolCall | undefined {
  const match = /[A-Za-z][A-Za-z0-9_]*__[A-Za-z0-9_]+/.exec(content);
  if (!match || match.index === undefined) {
    return undefined;
  }
  const name = match[0];
  const rest = content.slice(match.index + name.length).trimStart();
  if (!rest.startsWith("(")) {
    return undefined;
  }
  const inside = balancedParens(rest.slice(1));
  if (inside === undefined) {
    return undefined;
  }
  const args = parseKwArgs(inside);
  if (args === undefined) {
    return undefined;
  }
  return { id: nextTextCallId(), name, arguments: args };
}

/** Text before the matching `)` for `s` that begins inside an already-opened `(`. */
function balancedParens(source: string): string | undefined {
  let depth = 1;
  let inString = false;
  let quote = "";
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i] ?? "";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString && ch === "\\") {
      escaped = true;
      continue;
    }
    if (inString && ch === quote) {
      inString = false;
      continue;
    }
    if (inString) {
      continue;
    }
    if (ch === "\"" || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === "(") {
      depth += 1;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(0, i);
      }
    }
  }
  return undefined;
}

/** `key="value", key=123` into a JSON object. Keys are sorted, matching `encoding/json`. */
function parseKwArgs(source: string): string | undefined {
  const text = source.trim();
  if (text === "") {
    return "{}";
  }
  const args: Record<string, unknown> = {};
  let i = 0;
  while (i < text.length) {
    while (i < text.length && (isSpace(text[i] ?? "") || text[i] === ",")) {
      i += 1;
    }
    if (i >= text.length) {
      break;
    }
    const keyStart = i;
    while (i < text.length && (isLetter(text[i] ?? "") || isDigit(text[i] ?? "") || text[i] === "_")) {
      i += 1;
    }
    if (i === keyStart) {
      return undefined;
    }
    const key = text.slice(keyStart, i);
    while (i < text.length && isSpace(text[i] ?? "")) {
      i += 1;
    }
    if (i >= text.length || text[i] !== "=") {
      return undefined;
    }
    i += 1;
    while (i < text.length && isSpace(text[i] ?? "")) {
      i += 1;
    }
    if (i >= text.length) {
      return undefined;
    }
    const read = readKwValue(text, i);
    if (!read) {
      return undefined;
    }
    args[key] = read.value;
    i = read.next;
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(args).sort()) {
    sorted[key] = args[key];
  }
  return JSON.stringify(sorted);
}

function readKwValue(source: string, index: number): { value: unknown; next: number } | undefined {
  const quote = source[index] ?? "";
  if (quote === "\"" || quote === "'") {
    let i = index + 1;
    const start = i;
    let escaped = false;
    while (i < source.length) {
      const ch = source[i] ?? "";
      if (escaped) {
        escaped = false;
        i += 1;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        i += 1;
        continue;
      }
      if (ch === quote) {
        return { value: unescapeSimple(source.slice(start, i)), next: i + 1 };
      }
      i += 1;
    }
    return undefined;
  }
  let i = index;
  while (i < source.length && source[i] !== "," && !isSpace(source[i] ?? "")) {
    i += 1;
  }
  const token = source.slice(index, i);
  switch (token.toLowerCase()) {
    case "true":
      return { value: true, next: i };
    case "false":
      return { value: false, next: i };
    case "null":
      return { value: null, next: i };
    default:
      break;
  }
  if (/^[+-]?\d+$/.test(token)) {
    return { value: Number(token), next: i };
  }
  if (/^[+-]?(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(token) || /^[+-]?\d+[eE][+-]?\d+$/.test(token)) {
    const n = Number(token);
    if (Number.isFinite(n)) {
      return { value: n, next: i };
    }
  }
  const first = token[0] ?? "";
  if (token !== "" && (isLetter(first) || first === "_")) {
    return { value: token, next: i };
  }
  return undefined;
}

function unescapeSimple(source: string): string {
  return source.replaceAll("\\\"", "\"").replaceAll("\\'", "'").replaceAll("\\\\", "\\");
}

function firstString(fields: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }
  return "";
}

/** First key holding a JSON object, including the stringified form OpenAI uses. */
function firstObject(fields: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    if (!(key in fields)) {
      continue;
    }
    const value = fields[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return JSON.stringify(value);
    }
    if (typeof value === "string" && value.trim().startsWith("{")) {
      return value.trim();
    }
  }
  return "{}";
}

/** First balanced `{…}` run, ignoring braces inside string literals. */
function firstJSONObject(source: string): string | undefined {
  const start = source.indexOf("{");
  if (start < 0) {
    return undefined;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i] ?? "";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString && ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  return undefined;
}

function parseObject(source: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function isLetter(ch: string): boolean {
  return /\p{L}/u.test(ch);
}

function isDigit(ch: string): boolean {
  return /\p{Nd}/u.test(ch);
}

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v" || /\p{Zs}/u.test(ch);
}
