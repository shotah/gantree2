/** `net/url` QueryEscape + Values.Encode (sorted keys, space as `+`). */
export function queryEscape(s: string): string {
  return encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
}

export function encodeForm(fields: Record<string, string>): string {
  return Object.keys(fields)
    .sort()
    .map((key) => `${queryEscape(key)}=${queryEscape(fields[key] ?? "")}`)
    .join("&");
}
