export type ReleaseArgs = {
  bump: string;
  version: string;
  dryRun: boolean;
  skipPush: boolean;
  allowDirty: boolean;
  help: boolean;
  /** `npm run release -- --eval` writes `eval: force` on the version tag. */
  eval: boolean;
};

export function nextVersion(current: string, bump: string, explicit?: string): string;

export function versionWithoutV(tag: string): string;

export function parseArgs(argv: string[]): ReleaseArgs;
