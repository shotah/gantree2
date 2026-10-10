import { describe, expect, it } from "vitest";
import { nextVersion, parseArgs, versionWithoutV } from "../../scripts/semver.mjs";

describe("nextVersion", () => {
  it("bumps patch by default, minor and major reset the lower parts", () => {
    expect(nextVersion("v0.2.0", "patch")).toBe("v0.2.1");
    expect(nextVersion("v0.2.0", "")).toBe("v0.2.1");
    expect(nextVersion("v0.2.9", "minor")).toBe("v0.3.0");
    expect(nextVersion("v0.2.9", "MAJOR")).toBe("v1.0.0");
    expect(nextVersion("0.2.0", "patch")).toBe("v0.2.1");
  });

  it("starts from v0.0.1 with no tag yet, and honours an explicit version", () => {
    expect(nextVersion("", "patch")).toBe("v0.0.1");
    expect(nextVersion("", "minor")).toBe("v0.1.0");
    expect(nextVersion("v0.2.0", "patch", "v1.2.3")).toBe("v1.2.3");
    expect(nextVersion("v0.2.0", "patch", " 1.2.3 ")).toBe("v1.2.3");
  });

  it("refuses junk", () => {
    expect(() => nextVersion("v0.2.0", "huge")).toThrow(/invalid --bump/);
    expect(() => nextVersion("release-1", "patch")).toThrow(/not semver/);
    expect(() => nextVersion("v0.2.0", "patch", "v1.2")).toThrow(/invalid --version/);
  });
});

describe("release args", () => {
  it("parses every flag and strips the v", () => {
    expect(parseArgs([])).toEqual({ bump: "patch", version: "", dryRun: false, skipPush: false, allowDirty: false, help: false });
    expect(parseArgs(["--bump=minor", "--dry-run", "--skip-push", "--allow-dirty", "--version=v2.0.0"])).toEqual({
      bump: "minor",
      version: "v2.0.0",
      dryRun: true,
      skipPush: true,
      allowDirty: true,
      help: false,
    });
    expect(parseArgs(["-h"]).help).toBe(true);
    expect(() => parseArgs(["--nope"])).toThrow(/unknown arg --nope/);
    expect(versionWithoutV("v0.2.1")).toBe("0.2.1");
    expect(versionWithoutV("0.2.1")).toBe("0.2.1");
  });
});
