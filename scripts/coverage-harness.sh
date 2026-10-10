#!/usr/bin/env bash
# Harness coverage, MCP plugins rolled in.
#
# Runs `go test -cover` in every Go module under harness/ — the harness itself
# (harness/go.mod) and each baked-in plugin (harness/mcp/*/go.mod) — merges the
# profiles into one, and writes:
#
#   coverage/harness.out        merged cover profile
#   coverage/harness-func.txt   `go tool cover -func` with a single total: line
#
# The badge reads harness-func.txt. A module with no tests still counts: its
# statements land in the profile at zero, so an untested plugin lowers the number
# instead of hiding.
set -euo pipefail

ROOT="${1:-harness}"
OUT_DIR="${2:-coverage}"
MIN="${HARNESS_COVERAGE_MIN:-0}"

if [[ ! -f "$ROOT/go.mod" ]]; then
  echo "no $ROOT/go.mod — harness not imported yet" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
MERGED="$OUT_DIR/harness.out"
FUNC="$OUT_DIR/harness-func.txt"
: >"$MERGED"
echo "mode: atomic" >"$MERGED"

mapfile -t MODS < <({ echo "$ROOT"; find "$ROOT/mcp" -mindepth 2 -maxdepth 2 -name go.mod -printf '%h\n' 2>/dev/null | sort; })

for mod in "${MODS[@]}"; do
  echo "== $mod"
  prof="$(mktemp)"
  (cd "$mod" && go test ./... -coverprofile="$prof" -covermode=atomic -count=1)
  # Drop the per-module mode header; keep the body.
  tail -n +2 "$prof" >>"$MERGED"
  rm -f "$prof"
done

# `go tool cover -func` resolves file paths through the module in cwd. The merged
# profile spans modules, so point it at a go.work that lists them all.
WORK="$(mktemp -d)"
{
  echo "go $(sed -n 's/^go \([0-9.]*\).*/\1/p' "$ROOT/go.mod" | head -1)"
  echo "use ("
  for mod in "${MODS[@]}"; do
    echo "  $(realpath "$mod")"
  done
  echo ")"
} >"$WORK/go.work"

GOWORK="$WORK/go.work" go tool cover -func="$MERGED" >"$FUNC"
TOTAL="$(awk '/^total:/{print $3}' "$FUNC" | tr -d '%')"
echo "harness coverage (incl. mcp plugins): ${TOTAL}%"

if awk -v t="$TOTAL" -v m="$MIN" 'BEGIN{exit !(t+0 < m+0)}'; then
  echo "harness coverage ${TOTAL}% is below HARNESS_COVERAGE_MIN=${MIN}%" >&2
  exit 1
fi
