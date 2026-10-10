# Contributing

Thanks for looking. This is one person's household agent that others
run too; changes are welcome when they keep it small, tested, and
boring to operate.

## What goes where

| Folder | Language | Tests | Gate |
| --- | --- | --- | --- |
| `app/`, `lib/`, `edge/`, `worker/`, `middleware.ts` | TypeScript (Vinext on Workers) | `test/**` (Vitest) | `npm test`, `npm run lint`, `npm run typecheck`, coverage thresholds in `vitest.config.ts` |
| `scripts/*.ts`, `scripts/*.mjs`, `scripts/*.sh` | Node / bash | `test/scripts/**` | same |
| `harness/` | Go | `*_test.go` beside source | `go test ./...`, `go vet`, `scripts/coverage-harness.sh` with `HARNESS_COVERAGE_MIN` |
| `harness/mcp/<id>/` | Go, one module each | its own `*_test.go` incl. a name-lock test | same; `harness/mcp.lock` must list it |
| `site/` | static HTML/CSS | `test/scripts/pages.test.ts` | `npm run pages` builds clean |
| `docs/` | Markdown | — | links resolve inside this repo |

Layout rules, in one place: [`.cursor/rules/repo-layout.mdc`](.cursor/rules/repo-layout.mdc).
Short version: tests live under `test/` mirroring the source path, never
beside it; import with `@/`; pages are thin route shells and logic lives
in `lib/`.

## Setup

```sh
npm install
cp .dev.vars.example .dev.vars        # fill GOOGLE_CLIENT_ID/SECRET, SESSION_SECRET, GANTREE_ADMINS
npm run dev                           # http://127.0.0.1:3000
npm test                              # Vitest
make -C harness test                  # Go (needs Go 1.26)
```

`GANTREE_DEV_USER=sub:you@example.com` in `.dev.vars` skips Google on
loopback only. See [docs/install.md](docs/install.md).

## Before you open a PR

- `npm run lint` clean. Style is ESLint + `@stylistic`; there is no
  Prettier and do not add one. Do not disable `no-explicit-any` or
  `no-useless-assignment` to match old code — type it or delete it.
- `npm run typecheck` clean.
- `npm run test:coverage` above the thresholds. If you lower a number,
  say why in the PR; expect pushback.
- Go: `gofmt`, `go vet`, tests pass **offline** (gate network tests on
  an env var or `testing.Short()`).
- A new MCP plugin: id and tool names follow
  [docs/mcp-naming.md](docs/mcp-naming.md); a name-lock test; a row in
  `harness/mcp.lock`; an eval fixture if the catalog is public.
- A new env var or secret: add it to `.dev.vars.example` or
  `harness/.env.example`, the secrets table in
  [docs/security.md](docs/security.md), and the deploy workflow.
- A new route: decide if it is public and add it to the gate's list
  deliberately (`lib/door/gate.ts`). Default is gated.
- Docs: plain style like [docs/mcp-naming.md](docs/mcp-naming.md). No
  links to the retired repos; this one stands alone.

## Principles that decide reviews

- **Least change.** Fix the thing; do not reformat the file.
- **Import over write.** If a maintained library does it, use it.
- **The harness is never slower so a screen looks nicer.**
- **No inbound ports on the agent.** Any PR that adds one is closed.
- **Fail closed.** No admins → 503. Unknown route → gated.
- **Names are product names.** `agent`, `chat`, `settings`, `users`,
  `harness`. Not crane, pendant, yard, operator-as-a-noun.

## Commits and PRs

- One topic per PR. Small beats complete.
- Title in the imperative: `door: recompute role per request`.
- Describe what a stranger would see change, and how you tested it. A
  screenshot for anything visual.
- CI must be green: `ci.yml` (app), `harness.yml` (Go), and `eval.yml`
  when a plugin or the turn loop changed.
- No force-push after review starts; add commits, squash at merge.

## Security

Found a hole? Do not open an issue. See [SECURITY.md](SECURITY.md).

## License

MIT. By contributing you agree your change is MIT too.
