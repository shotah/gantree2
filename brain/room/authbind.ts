/**
 * Native `/auth` needs a catch redirect and a sealed state, and `SlashEnv`
 * is built inside the brain. The room binds both on the same `sql` object
 * the brain hands plugins, so slash can see them without a new `BrainDeps` field.
 */
export type RoomAuth = {
  /** Absolute `/api/auth/catch` URL the provider must redirect to. */
  redirectUri: () => string | Promise<string>;
  /** `sealOAuthCatch({ slug, plugin })` for this agent. */
  sealState: (plugin: string) => Promise<string>;
};

const binds = new WeakMap<object, RoomAuth>();

export function bindRoomAuth(sql: object, auth: RoomAuth): void {
  binds.set(sql, auth);
}

export function roomAuth(sql: object): RoomAuth | null {
  return binds.get(sql) ?? null;
}
