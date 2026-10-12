/** `net/url` QueryEscape, then Values.Encode (sorted keys, space as `+`). */
export function queryEscape(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*~]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
}

export function encodeQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${queryEscape(key)}=${queryEscape(params[key] ?? "")}`)
    .join("&");
}
