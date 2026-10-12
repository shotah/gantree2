# Contributing

Fork, then one topic per pull request. Title in the imperative.

## Setup

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

Node 22. Fill `.dev.vars` on your machine. Git holds
`.dev.vars.example` only.

`GANTREE_DEV_USER=sub:you@example.com` in `.dev.vars` skips Google on
loopback only. See [docs/install.md](docs/install.md).

## Checks

```sh
npm test
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

The pre-commit hook runs `npm test`, `npm run lint`, and `npm run typecheck` in parallel via Lefthook.

`npm run eval` when the change touches `harness/agent` or `harness/plugins`.
That run needs `LLM_*`. See [docs/eval_setup.md](docs/eval_setup.md).

CI on a pull request runs the coverage gate, lint, typecheck, and the
build. GitHub fills the pull request body from
[PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md).

Tool names follow [docs/mcp-naming.md](docs/mcp-naming.md).

A new env var or secret goes in `.dev.vars.example`, the secrets table
in [docs/security.md](docs/security.md), and the deploy workflow.

A new route stays gated unless it is added to the public list in
`lib/door/gate.ts` on purpose.

## Docs

Tick the line in [docs/todo.md](docs/todo.md) when the work closes it.
Write-ups go in `docs/`, plain style like
[docs/mcp-naming.md](docs/mcp-naming.md).

## Security

A hole is not an issue. See [SECURITY.md](SECURITY.md).

## License

MIT. A contribution is MIT too.
