# gantree

<p align="center">
  <a href="https://github.com/shotah/gantree2/actions/workflows/ci.yml"><img src="https://github.com/shotah/gantree2/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/shotah/gantree2/actions/workflows/ci.yml"><img src="https://github.com/shotah/gantree2/raw/gh-pages/badges/coverage.svg" alt="Coverage"></a>
  <a href="https://github.com/shotah/gantree2/actions/workflows/harness.yml"><img src="https://github.com/shotah/gantree2/actions/workflows/harness.yml/badge.svg" alt="Harness"></a>
  <a href="https://github.com/shotah/gantree2/actions/workflows/harness.yml"><img src="https://github.com/shotah/gantree2/raw/gh-pages/badges/harness-coverage.svg" alt="Harness coverage (incl. MCP plugins)"></a>
  <a href="https://github.com/shotah/gantree2"><img src="https://img.shields.io/github/package-json/v/shotah/gantree2?label=version" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/shotah/gantree2" alt="License"></a>
</p>

One repo, one Worker, one door. **Settings** for the people who run
agents, **chat** (a PWA) for the people who talk to them, and the
**harness** that is the agent — on Cloudflare, or at home under
[celld](https://github.com/denoland/celld) from the same `wrangler.jsonc`.

This is the side-by-side successor to
[gantree](https://github.com/shotah/gantree),
[gantry-pendant](https://github.com/shotah/gantry-pendant), and
[ai-gantry](https://github.com/shotah/ai-gantry). Those keep serving the
household until cutover. The plan, the auth model, and the phases live in
[docs/proposal.md](docs/proposal.md); the diagrams in
[docs/architecture.md](docs/architecture.md).

## Reliability

Two coverage numbers, both published to `gh-pages` on every push to
`main` and shown above:

| Badge | Covers | Floor |
| --- | --- | --- |
| **coverage** | the Worker: `lib/**`, `edge/**`, `app/lib/**` (Vitest, v8) | 60 % lines / statements / functions / branches, enforced by `vitest.config.ts` |
| **harness coverage** | the Go harness **and every baked-in MCP plugin** under `harness/mcp/*`, merged into one profile | `HARNESS_COVERAGE_MIN` in `.github/workflows/harness.yml` |

An untested plugin lowers the harness number instead of hiding behind
its own badge. Tests live under `test/`, mirroring the module they cover.

```sh
npm run test:coverage     # Worker, with the threshold gate
npm run coverage:harness  # harness + plugins, merged (once harness/ exists)
npm run badge             # badges/coverage.svg from the last run
npm run eval              # live-model behavior eval; the release gate (docs/eval_setup.md)
```

Plugins live and die by [docs/mcp-naming.md](docs/mcp-naming.md): a
renamed tool fails the eval before any model call.

## Docs

Site: [shotah.github.io/gantree2](https://shotah.github.io/gantree2)
(`npm run pages`). Same files under [`docs/`](docs/):

| Running it | The agent | The rules |
| --- | --- | --- |
| [install](docs/install.md) · [access](docs/access.md) · [security](docs/security.md) · [troubleshooting](docs/troubleshooting.md) | [persona](docs/persona.md) · [channels](docs/channels.md) · [cron](docs/cron.md) · [reactions](docs/reactions.md) · [planner-siblings](docs/planner-siblings.md) · [auth (connecting accounts)](docs/auth.md) | [architecture](docs/architecture.md) · [contract](docs/contract.md) · [mcp](docs/mcp.md) · [custom-mcp](docs/custom-mcp.md) · [mcp-naming](docs/mcp-naming.md) · [evals](docs/eval_setup.md) · [evaluation fable](docs/evaluation_fable.md) · [persona doc goals](docs/persona_doc_goals.md) |

Plan and backlog: [proposal](docs/proposal.md) · [todo](docs/todo.md).
Contributing: [CONTRIBUTING.md](CONTRIBUTING.md). Reporting a hole:
[SECURITY.md](SECURITY.md).

## Run it

```sh
cp .dev.vars.example .dev.vars   # Google client, SESSION_SECRET, GANTREE_ADMINS=you@example.com
npm ci
npm run dev                      # http://127.0.0.1:3000
```

The door is Google sign-in plus an allowlist. `GANTREE_ADMINS` and
`GANTREE_ALLOW` are the floor — set locally in `.dev.vars`, on Cloudflare
from GitHub Actions variables, at home via `CELLD_VARS_FILE`. More people
are added on **Users** once you are in. No passphrases, no second login.

| | |
| --- | --- |
| `npm run build` | Vite + Vinext → `dist/` |
| `npm run start` | the built Worker under `wrangler dev` |
| `npm run deploy` | Cloudflare (CI does this on `main`) |
| `npm run deploy:home` | `celld deploy` from the same manifest |
| `npm test` · `npm run lint` · `npm run typecheck` | what CI runs |

## Layout

```
app/            routes — thin shells; login, api/auth, (agents, chat, users, settings next)
app/lib/        browser helpers: theme, prefs, login copy
app/components/ shared/ThemeSelect and friends
lib/door/       allowlist · users · google · session · gate · http   (pure, tested)
lib/theme/      the fifteen themes, contrast gate, wire helpers      (from pendant)
edge/           Durable Objects (Settings, Agent) — Phase 1/2
harness/        the Go harness + harness/mcp/<plugin>/ — Phase 2
scripts/        badge.mjs · coverage-harness.sh · publish-pages.sh
test/           mirrors lib/, app/, scripts/
```

## Themes

All fifteen from pendant: **Boom**, **Paper**, **Ink**, then a mood
pair (dark, light) for happy, excited, sad, frustrated, angry, anxious.
Every pair meets AA on the surfaces we paint; `test/theme/catalog.test.ts`
holds the line. The agent can set the room's mood; a person can follow
it or pin their own.
