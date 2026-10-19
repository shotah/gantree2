# gantree

TypeScript Cloudflare Worker. Vinext in `app/`. The harness is in-process
TypeScript in the Agent Durable Object. Node 22. npm.

The Go harness is gone. Leave it gone. The harness opens no listen port.
The Vinext Worker is the HTTP API ([docs/openapi.yaml](docs/openapi.yaml)),
and Cloudflare fronts that Worker.

## Commands

```sh
npm ci
npm test
npm run test:coverage
npm run lint
npm run typecheck
npm run build
npm run eval
```

`npm run eval` is the live-model suite in `harness/eval`. Run it when
`harness/agent` or `harness/plugins` changes. Setup is `docs/eval_setup.md`.

CI runs coverage, lint, typecheck, and build. Thresholds live in
`vitest.config.ts`.

## Rules

Least change. Fix the thing. Leave the rest of the file as it was.

Import a maintained library when one already does the job.

A change needs a test. Tests live under `test/`, mirroring the source
path, never beside it. Import with `@/`.

ESLint is type-aware, with `@stylistic` (2-space indent, double quotes,
semicolons, 1tbs braces, trailing commas on multiline). There is no
Prettier. `no-explicit-any`, `no-unsafe-*`, `no-deprecated`, and
`no-floating-promises` are errors. Import `Buffer` from `node:buffer`.

Plugin tools are plural. The rule is
`.cursor/rules/harness-plugins-plural.mdc`. A tool takes a set and returns
a list. One match is `[item]`. A per-item miss is a row, not a failed
call. An inherently singular tool sets `single` to the reason.
`test/harness/plugins/plural.test.ts` fails a tool that is neither.

Host-facing tool names are `{plugin}__{tool}`. The plugin registers the
right-hand side only: `{service}_{verb}_{object}`. `harness/tools` adds
the prefix. Naming is `docs/mcp-naming.md`. A renamed tool fails the
eval before any model call.

Secrets stay out of git. `.dev.vars` is local. Keys live on the
assistant. Fixtures use placeholders. Logs do not include env values.

Write-ups belong in `docs/`, plain Markdown, same style as
`docs/mcp-naming.md`. A canvas is not a doc.

Migrations are namespaced `pkg.NNN` (`memory.001`). `migrate` records
applied ids in the shared `brain_migration` table. Each package passes
its own list on open. Keep the Go table and column names.

Fail closed. No admins means 503. A new route stays gated unless it is
added to the public list in `lib/door/gate.ts` on purpose.

## Where things live

`harness/core` is the contract: `Sql` (`exec`, `one`, `changes`), `Clock`,
`Logger`, the chat provider types, `Plugin` / `Tool` / `TokenStore`, and
the wire frames. Production SQL is `doSql` over the Durable Object.
Tests use `nodeSql`. `harness/core` does not import `node:sqlite`.

`harness/agent` is the turn loop. `harness/room` is the Agent Durable Object
adapter: it builds the harness from the room's storage, persona, SELF, and
tokens. `edge/agent.do.ts` fans the frames out. `edge/settings.do.ts` is
users, agents, and spend.

`harness/plugins/<id>` is one plugin. The ids are the directory names
there. `harness/tools` is the registry, the enable rules, the
manifest drift check, and the token store.

`harness/eval` holds the behavioral fixtures. `npm run eval` runs them
through Vitest (`vitest.eval.config.ts`).

`lib/door` is the door: allowlist, Google sign-in, session, gate.
Security-sensitive.

`app/` is thin routes. Logic lives in `lib/`.
