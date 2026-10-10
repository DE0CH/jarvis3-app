#!/usr/bin/env bash
# Fails unless a signed .app (or the app inside an .ipa) carries the aps-environment entitlement
# with the expected value. Without it iOS gives the app no APNs token and the instance can't push.
# Usage: check-push-entitlement.sh <path to .app or .ipa> [production|development]
set -euo pipefail
TARGET="$1"
WANT="${2:-production}"
if [[ "$TARGET" == *.ipa ]]; then
  DIR="$(mktemp -d)"
  trap 'rm -rf "$DIR"' EXIT
  unzip -q "$TARGET" -d "$DIR"
  TARGET="$(ls -d "$DIR"/Payload/*.app | head -1)"
fi
ENT="$(codesign -d --entitlements :- "$TARGET" 2>/dev/null || true)"
if [[ -z "$ENT" ]]; then
  echo "::error::$TARGET has no entitlements (unsigned?)"
  exit 1
fi
GOT="$(printf '%s' "$ENT" | plutil -extract aps-environment raw -o - - 2>/dev/null || true)"
if [[ "$GOT" != "$WANT" ]]; then
  echo "::error::aps-environment is '${GOT:-missing}', expected '$WANT' (push notifications would not work)"
  printf '%s\n' "$ENT"
  exit 1
fi
echo "aps-environment: $GOT"
