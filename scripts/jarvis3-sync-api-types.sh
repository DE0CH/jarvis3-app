#!/usr/bin/env bash
# Refreshes packages/app/src/jarvis3/api-types.ts from DE0CH/jarvis3 server/src/api-types.ts
# (the API contract; type-only). Usage: scripts/jarvis3-sync-api-types.sh [path to a jarvis3 checkout]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-}"
if [[ -z "$SRC" ]]; then
  SRC="$(mktemp -d)"
  git clone -q --depth 1 https://github.com/DE0CH/jarvis3.git "$SRC"
fi
COMMIT="$(git -C "$SRC" rev-parse --short HEAD)"
OUT="$ROOT/packages/app/src/jarvis3/api-types.ts"
{
  echo "// Vendored from DE0CH/jarvis3 server/src/api-types.ts (commit $COMMIT); refresh with"
  echo "// scripts/jarvis3-sync-api-types.sh. Type-only: never add runtime code here."
  cat "$SRC/server/src/api-types.ts"
} > "$OUT"
echo "api-types.ts <- jarvis3@$COMMIT"
