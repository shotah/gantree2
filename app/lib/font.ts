/** Chat type size — Small matches today's `text-sm` bubbles. */

export const FONT_KEY = "gantree.font";

export const FONTS = [
  { id: "sm", label: "Small", size: "0.875rem" },
  { id: "md", label: "Medium", size: "1rem" },
  { id: "lg", label: "Large", size: "1.25rem" },
  { id: "xl", label: "Extra large", size: "1.5rem" },
] as const;

export type FontId = (typeof FONTS)[number]["id"];

export const DEFAULT_FONT: FontId = "sm";

const FONT_IDS: readonly string[] = FONTS.map((f) => f.id);

export function fontOf(id: FontId = DEFAULT_FONT) {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

export function parseFont(v: unknown): FontId {
  return typeof v === "string" && FONT_IDS.includes(v) ? (v as FontId) : DEFAULT_FONT;
}

export function fontFromQuery(v: string | null): FontId | null {
  return typeof v === "string" && FONT_IDS.includes(v) ? (v as FontId) : null;
}

export function fontCss(): string {
  const vars = FONTS.map((f) => {
    const sel = f.id === DEFAULT_FONT ? `:root,[data-font="${f.id}"]` : `[data-font="${f.id}"]`;
    return `${sel}{--chat-font:${f.size}}`;
  }).join("");
  return `${vars}.text-chat{font-size:var(--chat-font);line-height:1.625}`;
}

export function applyFont(id: FontId): void {
  if (document.documentElement.getAttribute("data-font") === id && localStorage.getItem(FONT_KEY) === id) {
    return;
  }
  document.documentElement.setAttribute("data-font", id);
  localStorage.setItem(FONT_KEY, id);
  window.dispatchEvent(new Event("gantree-font"));
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/[<>/\u2028\u2029]/g, (ch) => {
    if (ch === "<") return "\\u003C";
    if (ch === ">") return "\\u003E";
    if (ch === "/") return "\\u002F";
    if (ch === "\u2028") return "\\u2028";
    return "\\u2029";
  });
}

export const FONT_BOOT
  = `(function(){try{var t=localStorage.getItem(${jsonForScript(FONT_KEY)});var a=${jsonForScript(FONT_IDS)};if(a.indexOf(t)!==-1)document.documentElement.setAttribute("data-font",t)}catch(e){}})();`;
