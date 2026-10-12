/**
 * Live aim notes. Aims does not read the memory tables; the memory package
 * implements this and aims only asks for `aim/<area>` rows.
 */
export type AimNote = {
  subject: string;
  content: string;
};

export type AimMemory = {
  /**
   * Live insight rows whose subject starts with `aim/`, including
   * `aim/bootstrap`. Newest update first is fine; `areas` sorts and drops
   * bootstrap itself.
   */
  listAims(): readonly AimNote[];
  /** Live sentence for `aim/<area>`, or null when that row is absent. */
  sentence(area: string): string | null;
};
