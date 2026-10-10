#!/bin/sh
# Build every Go module under mcp/*/ to /opt/mcp/<id>/<id>.
# When the module implements host-manifest, write
# /opt/mcp/<id>/host-manifest.json beside that binary.
# One binary per plugin. The harness resolves a bare command to that
# path; this script does not copy onto PATH or under the old module name.
# An empty or missing mcp/ directory is success. Does not read mcp.lock.
set -eu

os="${TARGETOS:-linux}"
arch="${TARGETARCH:-amd64}"

mkdir -p /opt/mcp
touch /opt/mcp/.keep

if [ ! -d mcp ]; then
  echo "no mcp/ directory; skipping plugin build"
  exit 0
fi

find mcp -mindepth 2 -maxdepth 2 -name go.mod > /tmp/mcp-mods
if [ ! -s /tmp/mcp-mods ]; then
  echo "no mcp/*/go.mod; skipping plugin build"
  exit 0
fi

# True when some .go file mentions the host-manifest subcommand.
has_manifest() {
  find "$1" -name '*.go' > /tmp/mcp-go-files
  while IFS= read -r f; do
    if grep -q 'host-manifest' "$f"; then
      return 0
    fi
  done < /tmp/mcp-go-files
  return 1
}

while IFS= read -r mod; do
  [ -n "$mod" ] || continue
  dir=$(dirname "$mod")
  id=$(basename "$dir")
  dest="/opt/mcp/$id"
  mkdir -p "$dest"

  target="."
  if [ ! -f "$dir/main.go" ]; then
    target=""
    for c in "$dir"/cmd/*/; do
      [ -d "$c" ] || continue
      base=$(basename "$c")
      case "$base" in
        release|release-packager) continue ;;
      esac
      if [ -z "$target" ]; then
        target="./cmd/$base"
      fi
      if has_manifest "$c"; then
        target="./cmd/$base"
        break
      fi
    done
    if [ -z "$target" ]; then
      echo "mcp/$id: no main package" >&2
      exit 1
    fi
  fi

  echo "building mcp/$id ($target)"
  (cd "$dir" && GOOS="$os" GOARCH="$arch" CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o "$dest/$id" "$target")

  if has_manifest "$dir"; then
    set +e
    (cd "$dir" && timeout 30s go run "$target" host-manifest > "$dest/host-manifest.json")
    rc=$?
    set -e
    if [ "$rc" -eq 124 ] || [ "$rc" -eq 143 ]; then
      echo "mcp/$id: host-manifest timed out; shape not shipped" >&2
      rm -f "$dest/host-manifest.json"
    elif [ "$rc" -ne 0 ]; then
      echo "mcp/$id: host-manifest exited $rc" >&2
      exit "$rc"
    fi
  fi
done < /tmp/mcp-mods
