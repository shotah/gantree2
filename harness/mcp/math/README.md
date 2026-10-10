# mcp-go-math

Static Go [MCP](https://modelcontextprotocol.io) calculator for AI agents. Gives the model a real arithmetic / unit-conversion tool so it does not invent numbers in chain-of-thought.

Built for [ai-gantry](https://github.com/shotah/ai-gantry) / LOCAL_AGENT: few tools (2), stdio only, `CGO_ENABLED=0` binary that fits distroless.

## Tools

| Tool | Description |
| --- | --- |
| `expression_evaluate` | Math expression → number (`2^10`, `sqrt(16)`, `sin(pi/2)`, …) |
| `units_convert` | Unit conversion (`5 mi→km`, `220 lb→kg`, `32 F→C`, …) |

In ai-gantry these appear as `math__expression_evaluate` / `math__units_convert`.

### Expression surface

- Operators: `+ - * / % **` (and `^` as power)
- Percentages: `17.5% of 240`, `50%`, `100 * 17.5%` (modulo needs spaces: `10 % 3`, or `mod(10, 3)`)
- Constants: `pi`, `e`, `phi`
- Functions: `abs`, `sqrt`, `pow`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `log`, `log10`, `log2`, `exp`, `floor`, `ceil`, `round`, `trunc`, `min`, `max`, `mod`, `hypot`, `sinh`, `cosh`, `tanh`, `deg`, `rad`
- Trig uses **radians** (use `rad(90)` for degrees)

### Unit notes

- `gallon` / `gal` = **imperial** (UK)
- `us_gallon` / `us_gal` / `fluid gallon` = **US liquid** gallon

Evaluation uses [expr-lang/expr](https://github.com/expr-lang/expr) with a math-only environment (no I/O). Conversions use [bcicen/go-units](https://github.com/bcicen/go-units).

## Development

```bash
make help                 # list targets
make tools                # install goimports-reviser + golangci-lint v2
make install-hooks        # git pre-commit: autofix + lint + test + coverage
make check                # same checks as the pre-commit hook
make cli                  # static binary → ./bin/mcp-go-math
make self-test
```

The pre-commit hook (`scripts/pre-commit`) runs on every commit after
`make install-hooks`:

1. `goimports-reviser` + `golangci-lint` autofix
2. `golangci-lint run`
3. `go test ./...`
4. coverage gate (≥70%)

## Releasing

GoReleaser publishes static binaries on `v*` tags (see `.github/workflows/release.yml`).

```bash
make version                 # show VERSION + next patch (dry-run)
make release                 # patch bump, commit VERSION, tag, push
make release BUMP=minor
make release TAG=v0.1.0
```

## Run as MCP (stdio)

```bash
./bin/mcp-go-math
```

Logs go to **stderr** only — stdout is reserved for the MCP protocol.

Example Cursor / client config:

```json
{
  "mcpServers": {
    "math": {
      "command": "mcp-go-math"
    }
  }
}
```

ai-gantry `mcp.toml`:

```toml
[[server]]
name = "math"
command = "mcp-go-math"
```

## Why not a 15-tool calculator?

Small local models (e.g. Qwen) hallucinate tool names once a server exposes a large surface. One `expression_evaluate` tool covers arithmetic; `units_convert` covers units. That is intentional.
