# Testing

This project uses VCR-style testing to record and replay API interactions.

## Overview

- **Unit tests**: Test data structures and helpers without API calls
- **Integration tests**: Test real API interactions using recorded cassettes

## Recording fixtures

```bash
# 1) Interactive login (email / password / MFA) → gitignored settings.json
make auth

# 2) Record/update ALL cassettes using that session
make fixtures

# Or one cassette / pin a date
make fixtures CASSETTE=usersummary
make fixtures DATE=2026-07-14
```

```bash
go run ./cmd/record-fixtures -list
go run ./cmd/record-fixtures -cassette=activities
```

This creates/updates cassette files in `testdata/cassettes/`.

## Running tests

```bash
# Unit tests (default — what pre-commit / CI / make check run)
make test
go test ./...
```

### Integration tests (opt-in)

Integration tests replay VCR cassettes. They are behind `//go:build integration`, so they do **not** run with plain `go test`, pre-commit, or CI.

**Prerequisite:** authenticate first so fixtures can be recorded/updated. Without a session, `make fixtures` cannot refresh cassettes and integration tests will fail on date/ID mismatches.

```bash
# 1) Login → gitignored settings.json (required)
make auth
# equivalent: go run ./cmd/garmin-auth

# 2) Record/refresh cassettes using that session
make fixtures
# or: make fixtures CASSETTE=hrv

# 3) Run integration tests
make test-integration
# equivalent: go test ./garmin/ -tags=integration -v
```

Committed cassettes can replay without a live login, but they must match what the tests request. After API or date drift, always re-run `make auth` → `make fixtures` before `make test-integration`.

## Pre-commit

```bash
make tools           # goimports-reviser + golangci-lint v2
make install-hooks   # .git/hooks/pre-commit
```

On each commit the hook runs autofix (`goimports-reviser`, `golangci-lint --fix`), lint, endpoint validation, and `go test ./...`, then re-stages files it fixed.

Local equivalent: `make check`.

## How it works

1. **Recording**: `make auth` writes `settings.json`. `make fixtures` reuses that session and records each API cassette.
2. **Sanitization**: Sensitive data is anonymized before saving (auth headers, tickets, names, IDs, profile URLs, etc.).
3. **Replay**: Integration tests load a fake session and replay cassettes without live API calls.

## Adding new tests

1. Add a recorder in `cmd/record-fixtures/main.go` and register it in `getCassetteRecorders()`
2. Add a corresponding test in `garmin/integration_test.go`
3. Run `make fixtures CASSETTE=<name>`

## Security notes

- Never commit `settings.json` or real credentials
- Cassettes are sanitized; still review them before committing
- `testdata/cassettes/` is safe to commit when anonymized
