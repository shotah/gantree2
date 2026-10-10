# Agent / contributor notes

## Verification

After code changes, run:

```bash
make check
make validate-endpoints
```

Or install the git hook once: `make install-hooks` (autofix + lint + validate + unit tests on commit).

VCR integration tests are opt-in and are **not** part of `make check`. They require a prior auth session to record/refresh cassettes:

```bash
make auth                 # required first → settings.json
make fixtures             # record/update cassettes
make test-integration     # go test -tags=integration
```

## Adding endpoints

This project uses a **declarative endpoint registry**. One definition generates the CLI command and MCP tool.

1. Add an endpoint to `endpoint/definitions/<service>.go`
2. Register it in `endpoint/definitions/register.go` if the file is new
3. Implement the service method in `garmin/service_<name>.go` when needed
4. Record a cassette: `make auth` then `make fixtures CASSETTE=<name>`
5. Run `make check` and `make validate-endpoints`

### Endpoint sketch

```go
{
    Name:          "GetData",
    Service:       "ServiceName",
    Cassette:      "cassette_name", // or "none"
    Path:          "/api/path",
    HTTPMethod:    "GET",
    Params: []endpoint.Param{
        {Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Date (YYYY-MM-DD)"},
    },
    CLICommand:    "service",
    CLISubcommand: "subcommand",
    MCPTool:       "service_get_data", // {service}_{verb}_{object} — no garmin_ prefix
    Short:         "Short description",
    Long:          "Longer description (this is what MCP models see)",
    Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
        client, ok := c.(*garmin.Client)
        if !ok {
            return nil, fmt.Errorf("handler received invalid client type: %T", c)
        }
        return client.Service.GetData(ctx, args.Date("date"))
    },
}
```

Param types: `ParamTypeString`, `ParamTypeInt`, `ParamTypeDate`, `ParamTypeDateRange`, `ParamTypeBool`.

#### LLM-friendly `Long` descriptions (MCP)

MCP exposes `Endpoint.Long` as the tool description (`mcp.WithDescription`). Write it for models routing user questions to the right tool:

1. **What it returns** — name concrete fields or payload shape in one short phrase.
2. **`Use for …`** — include natural-language phrases users actually say (quoted or paraphrased).
3. **Disambiguation** — when similar tools exist, add **Prefer X** / **Not Y** with the other tool’s `MCPTool` name.
4. **Date semantics** — for overnight or sleep-adjacent metrics, say whether `date` is the **calendar day** (often wake-up day). Put the same hint on the `date` param `Description` when it helps.

Keep `Long` under ~350 characters when practical. `Short` should be intent-oriented (not bare “Get foo”).

### Code style

- Optional JSON fields: pointers (`*int`, `*float64`, `*string`)
- Responses: include `raw json.RawMessage` and `RawJSON()`
- Naming: `GetDaily`, `List`, `Get`, `GetRange`

### Fixture auth

```bash
make auth       # interactive login → gitignored settings.json
make fixtures   # uses settings.json (no .env)
```

See [TESTING.md](TESTING.md), [ENDPOINTS.md](ENDPOINTS.md), and [README.md](README.md).
