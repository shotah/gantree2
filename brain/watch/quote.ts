/** Go `strconv.Quote` / `%q` for the strings the harness printed. */
export function goQuote(s: string): string {
  let out = "\"";
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    const ch = s.charAt(i);
    if (c === 0x22 || c === 0x5c) out += `\\${ch}`;
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0d) out += "\\r";
    else if (c === 0x09) out += "\\t";
    else if (c < 0x20 || c === 0x7f) out += `\\x${c.toString(16).padStart(2, "0")}`;
    else out += ch;
  }
  return `${out}"`;
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "unknown error";
}
