#!/usr/bin/env node
/**
 * Cut a release: bump semver, refresh docs/openapi.yaml to that version,
 * commit both, annotated tag (v* plus a floating `latest`), push. The tag
 * starts release.yml (GitHub Release with
 * generated notes); the push to main runs ci.yml, and deploy-cloudflare.yml
 * ships the Worker once ci is green.
 *
 *   npm run release                      # patch
 *   npm run release -- --bump=minor
 *   npm run release -- --bump=major
 *   npm run release -- --version=v0.3.0
 *   npm run release:dry                  # print current → next, touch nothing
 *
 * Same shape as gantry-pendant's release so the two repos release alike.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { nextVersion, parseArgs, versionWithoutV } from "./semver.mjs";

const root = resolve(import.meta.dirname, "..");
process.chdir(root);

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log("npm run release [-- --bump=patch|minor|major] [-- --version=vX.Y.Z] [-- --dry-run] [-- --skip-push] [-- --allow-dirty]");
  process.exit(0);
}

function git(argv, { okFail = false } = {}) {
  const r = spawnSync("git", argv, { encoding: "utf8" });
  if (r.status !== 0 && !okFail) {
    throw new Error(r.stderr || r.stdout || `git ${argv.join(" ")} failed`);
  }
  return (r.stdout || "").trim();
}

function gitLive(argv) {
  const r = spawnSync("git", argv, { stdio: "inherit" });
  if (r.status !== 0) {
    throw new Error(`git ${argv.join(" ")} failed`);
  }
}

function npmLive(argv) {
  const r = spawnSync("npm", argv, { stdio: "inherit" });
  if (r.status !== 0) {
    throw new Error(`npm ${argv.join(" ")} failed`);
  }
}

git(["fetch", "--tags", "--quiet"], { okFail: true });

const tags = git(["tag", "-l", "v*", "--sort=-v:refname"], { okFail: true });
const currentTag = tags.split("\n").map((t) => t.trim()).find(Boolean) || "";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const current = currentTag || (pkg.version ? `v${pkg.version}` : "");
const next = nextVersion(current, args.bump, args.version);

console.log(`Current tag: ${current || "(none)"}`);
console.log(`Next tag:    ${next}`);
console.log("Also tag:    latest (moves to same commit)");

if (args.dryRun) {
  console.log("Dry run — no commit, tag, or push.");
  process.exit(0);
}

if (!args.allowDirty) {
  const dirty = git(["status", "--porcelain"]);
  if (dirty) {
    throw new Error(`working tree is dirty; commit or stash first (or --allow-dirty):\n${dirty}`);
  }
}

npmLive(["version", versionWithoutV(next), "--no-git-tag-version"]);
npmLive(["run", "openapi"]);
gitLive(["add", "package.json", "package-lock.json", "docs/openapi.yaml"]);
const staged = git(["status", "--porcelain", "package.json", "package-lock.json", "docs/openapi.yaml"]);
if (staged) {
  gitLive(["commit", "-m", `chore: release ${next}`]);
  console.log("Committed package.json version.");
} else {
  console.log("package.json already at", next);
}

gitLive(["tag", "-a", next, "-m", `Release ${next}`]);
console.log("Created tag", next);
gitLive(["tag", "-fa", "latest", "-m", `Release ${next} (latest)`]);
console.log("Moved tag latest →", next);

if (args.skipPush) {
  console.log("Skipped push (--skip-push).");
  process.exit(0);
}

gitLive(["push", "origin", "HEAD"]);
gitLive(["push", "origin", next]);
gitLive(["push", "--force", "origin", "refs/tags/latest"]);
console.log(`Pushed HEAD, ${next}, and latest — GitHub Release, ci, and the Cloudflare deploy should start.`);
