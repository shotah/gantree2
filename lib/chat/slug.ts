/** Agent slug: letter first, then letters, digits, hyphen. Max 32. */
const SLUG = /^[a-z][a-z0-9-]{0,31}$/;

export function parseSlug(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  return SLUG.test(s) ? s : null;
}

/** `/ws/kit` → `kit`. */
export function slugFromPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "ws" || parts.length !== 2) {
    return null;
  }
  return parseSlug(parts[1] ?? "");
}

/** Lock-screen title. Empty slug stays "Kit", the name the harness already uses. */
export function displaySlug(slug: string): string {
  const s = slug.trim();
  if (!s) {
    return "Kit";
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}
