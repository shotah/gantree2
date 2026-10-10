# TODO — MCP tool rename (`{service}_{verb}_{object}`)

**Status:** done in-repo (release + ai-gantry `TOOLS.md` still yours)  
**Why:** Hosts expose `{server}__{tool}` (ai-gantry server id = `math`). Bare
`evaluate` / `convert` are too generic next to other MCPs. Align with google-mcp.

**Rule:** Do **not** double-prefix with `math_` as `{math}_{math}_…`. Use a
*domain* service token (`expression`, `units`).

**Consumer:** ai-gantry persona + master Qwen train plan (`todo.md`).

---

## Rename map (2 tools)

| Old | New | Host after |
| --- | --- | --- |
| `evaluate` | `expression_evaluate` | `math__expression_evaluate` |
| `convert` | `units_convert` | `math__units_convert` |

Checklist:

- [x] Rename tool registration in `internal/mcp`
- [x] Update README examples
- [x] Tests
- [ ] Release; update ai-gantry `TOOLS.md`

---

## Out of scope

- Adding more math tools
- Dual aliases
