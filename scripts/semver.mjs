/** Semver bump for scripts/release.mjs. Same rules as gantry-pendant so the two repos release alike. */

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** Next `vX.Y.Z` from the current tag and a bump, or the explicit `--version` when given. */
export function nextVersion(current, bump, explicit) {
  if (explicit) {
    const m = String(explicit).trim().match(SEMVER);
    if (!m) {
      throw new Error(`invalid --version ${JSON.stringify(explicit)} (want vMAJOR.MINOR.PATCH)`);
    }
    return `v${m[1]}.${m[2]}.${m[3]}`;
  }

  let major = 0;
  let minor = 0;
  let patch = 0;
  if (current) {
    const m = current.match(SEMVER);
    if (!m) {
      throw new Error(`latest tag ${JSON.stringify(current)} is not semver; pass --version=vX.Y.Z`);
    }
    major = Number(m[1]);
    minor = Number(m[2]);
    patch = Number(m[3]);
  }

  switch (String(bump || "patch").toLowerCase()) {
    case "patch":
    case "":
      patch += 1;
      break;
    case "minor":
      minor += 1;
      patch = 0;
      break;
    case "major":
      major += 1;
      minor = 0;
      patch = 0;
      break;
    default:
      throw new Error(`invalid --bump ${JSON.stringify(bump)} (want patch, minor, or major)`);
  }
  return `v${major}.${minor}.${patch}`;
}

export function versionWithoutV(tag) {
  return tag.replace(/^v/, "");
}

export function parseArgs(argv) {
  const out = { bump: "patch", version: "", dryRun: false, skipPush: false, allowDirty: false, help: false, eval: false };
  for (const a of argv) {
    if (a === "--dry-run") {
      out.dryRun = true;
    } else if (a === "--eval") {
      out.eval = true;
    } else if (a === "--skip-push") {
      out.skipPush = true;
    } else if (a === "--allow-dirty") {
      out.allowDirty = true;
    } else if (a.startsWith("--bump=")) {
      out.bump = a.slice("--bump=".length);
    } else if (a.startsWith("--version=")) {
      out.version = a.slice("--version=".length);
    } else if (a === "--help" || a === "-h") {
      out.help = true;
    } else {
      throw new Error(`unknown arg ${a}`);
    }
  }
  return out;
}
