#!/usr/bin/env bash
# Copy files into the gh-pages branch and push. Additive: only the paths you
# pass are replaced, so the app badge, the harness badge, and the docs site can
# each publish from their own workflow without erasing the others.
#
#   scripts/publish-pages.sh "<msg>" src1:dest1 [src2:dest2 ...]
#
# Needs GITHUB_TOKEN + GITHUB_REPOSITORY (GitHub Actions sets both). Retries the
# push a few times for the case where two workflows land at once.
set -euo pipefail

MSG="${1:?commit message}"
shift
if [[ $# -eq 0 ]]; then
  echo "nothing to publish" >&2
  exit 1
fi

: "${GITHUB_TOKEN:?}"
: "${GITHUB_REPOSITORY:?}"

SRC_ROOT="$(pwd)"
WORK="$(mktemp -d)"
cd "$WORK"
git init -q
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"

for attempt in 1 2 3 4 5; do
  if git fetch -q --depth 1 origin gh-pages 2>/dev/null; then
    git checkout -q -B gh-pages FETCH_HEAD
  else
    git checkout -q --orphan gh-pages
    git rm -rfq . >/dev/null 2>&1 || true
  fi

  for pair in "$@"; do
    src="${pair%%:*}"
    dest="${pair#*:}"
    [[ "$src" = /* ]] || src="$SRC_ROOT/$src"
    rm -rf "./$dest"
    mkdir -p "$(dirname "./$dest")"
    cp -a "$src" "./$dest"
  done
  touch .nojekyll

  git add -A
  if git diff --staged --quiet; then
    echo "gh-pages unchanged; nothing to push."
    exit 0
  fi
  git commit -q -m "$MSG"
  if git push -q origin HEAD:gh-pages; then
    echo "pushed gh-pages ($MSG)"
    exit 0
  fi
  echo "push lost a race (attempt $attempt); refetching"
  git reset -q --hard
  sleep $((attempt * 2))
done

echo "could not push gh-pages after 5 attempts" >&2
exit 1
