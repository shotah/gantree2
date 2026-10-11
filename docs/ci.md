# CI

How this repo ships. `GITHUB_TOKEN` is the token Actions creates for a run.

## Workflows

| Workflow | Trigger | Gates | Needs | Now |
| --- | --- | --- | --- | --- |
| `ci` | push `main`, `pull_request` | check `app`: test, lint, typecheck, build; coverage badge on main | `GITHUB_TOKEN` | green on the next push |
| `codeql` | push `main`, PR into `main`, Mon 05:20 UTC | `Analyze (javascript-typescript)` | none | green |
| `scorecard` | branch protection, Mon 06:20 UTC, push `main` | OpenSSF score and SARIF | `id-token`, `security-events` | fixed in this tree |
| `dependency-review` | `pull_request` | a new known-vulnerable dependency | none | green |
| `labeler` | `pull_request_target` | labels from `.github/labeler.yml` | labels `brain`, `plugins`, `edge`, `app`, `docs`, `ci`, `tests` | labels exist |
| `pages` | push `main` when `site/`, `docs/`, `assets/`, or the page scripts change; `workflow_dispatch` | site on `gh-pages` | optional `PAGES_CUSTOM_DOMAIN`, `GOOGLE_SITE_VERIFICATION` | green |
| `eval` | `v*` tag; `workflow_dispatch` and `workflow_call` | live eval beside `release`. Missing `LLM_*` prints a notice and the job succeeds | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | runs on the tag |
| `release` | `v*` tag | GitHub Release | `GITHUB_TOKEN` | does not wait on eval |
| `deploy-cloudflare` | `ci` finished on `main`; `workflow_dispatch` | `gate` fails unless `ci` succeeded; `deploy` needs `gate`. Environment `cloudflare` | vars `GOOGLE_CLIENT_ID`, `GANTREE_ADMINS`, `GANTREE_ALLOW`, optional `VAPID_SUBJECT`; secrets `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, optional `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | follows `ci` |
| `stale` | daily 07:30 UTC; `workflow_dispatch` | stale at 90 days, close after another 30. `pinned` and `security` stay | none | scheduled |
| Dependabot | weekly | npm minor and patch in one PR; other majors alone. `typescript` majors ignored | none | ignore is in the file |

A tag eval uses `EVAL_N=1` (one pass). A hand run defaults to 3. `ci` and `pages` share group `gh-pages` (a queued run drops). `eval` cancels the run already going.

## Fixes in flight

- **`ci` / `app`.** The ten failures on main are in the native-only pass (container removal): `ToolsFold` and `SecretsFold` runtime hints, `open.test.ts` persona and provider wiring, `agent.do` runtime and snapshot assertions. Fixed there; `ci` goes green on the next push.
- **`scorecard`.** Pinned to `ossf/scorecard-action` v2.4.4 in this tree. Green on the next push to `main`.
- **TypeScript 7.** `dependabot.yml` ignores `typescript` majors (`typescript-eslint` peers `<6.1.0`). Pull request 3 is closed.

## Owner clicks

Done: labels `brain`, `plugins`, `edge`, `app`, `docs`, `ci`, `tests`. Dependabot security updates are on. CodeQL default setup is `not-configured` (this repo's `codeql.yml` is the scan). Private vulnerability reporting is on. Pages publishes from `gh-pages`.

No remaining click.

## Release

`npm run release` (`scripts/release.mjs`) bumps patch unless `--bump=minor`, `--bump=major`, or `--version=vX.Y.Z`. `npm run release:dry` prints current → next and stops. It takes the newest `v*` tag (else `package.json`), runs `npm version --no-git-tag-version`, commits `package.json` and `package-lock.json` as `chore: release vX.Y.Z` when they changed, annotated-tags that version, moves annotated tag `latest` to the same commit, and pushes `HEAD`, the version tag, and force-pushes `latest`. A dirty tree stops it (`--allow-dirty`). `--skip-push` stops before the push.

On the tag: `release` opens the GitHub Release (a `-` in the tag is a prerelease). `eval` runs in parallel at `EVAL_N=1` and does not block. Re-add the gate once fixtures are stable (`TODO(2026-10-11, release-gate)` in `release.yml`) and drop the tag trigger on `eval.yml` when you do. On `main`: `ci`, then `deploy-cloudflare` (`gate` fails the deploy when `ci` is not success). `workflow_dispatch` deploys by hand.

No branch rules on main: one developer. Add a ruleset (PR + `app` + `Analyze (javascript-typescript)`) when a second committer arrives.

After a deploy: `curl -fsS https://gantree2.bldhosting.com/api/health` (`{ok, version, time}`, public, `cache-control: no-store`).
