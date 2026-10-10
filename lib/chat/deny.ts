/** Same body for unknown user and bad token — no enumeration. */

export function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

/** Signed-in but not on this room. Same body as 401 so we do not name the slug. */
export function forbidden(): Response {
  return Response.json({ error: "unauthorized" }, { status: 403 });
}

export function configError(): Response {
  return Response.json({ error: "config" }, { status: 503 });
}
