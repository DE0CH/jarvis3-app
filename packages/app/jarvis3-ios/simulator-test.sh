#!/usr/bin/env bash
# Simulator test of the jarvis3 iOS build against the MOCK instance (e2e-jarvis3/mock-instance.ts),
# never a real one: the app must have been built with JARVIS3_INSTANCE_URL=http://localhost:8090.
# Maestro walks the real pairing flow (Sign in -> system sign-in sheet -> the mock's sign-in page ->
# jarvis3://paired -> Keychain), checks the task list loads with the device token, then relaunches
# the app and checks it is still paired. Screenshots (mock data only) go to $OUT.
# Usage: simulator-test.sh --boot              create and start booting the simulator, install Maestro
#        simulator-test.sh <path to the .app>   env: JARVIS3_BUNDLE_ID
# Run --boot at the start of the job: a fresh simulator's first boot (data migration, system apps)
# takes 2-6 minutes of a runner's CPU, and when it overlaps Maestro's driver start the driver can
# miss its 5-minute window ("iOS driver not ready in time"). Booted early, it settles during the build.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${GITHUB_WORKSPACE:-$PWD}/jarvis3-ios-test-output"
UDID_FILE="${RUNNER_TEMP:-/tmp}/jarvis3-e2e-udid"
mkdir -p "$OUT"
export PATH="$HOME/.maestro/bin:$PATH"
if ! command -v maestro >/dev/null; then
  curl -fsSL "https://get.maestro.mobile.dev" | bash
fi

create_and_boot() {
  # Newest iOS runtime, an iPhone 17 (or any iPhone) on it.
  RUNTIME=$(xcrun simctl list runtimes -j | python3 -c '
import json,sys
rs=[r for r in json.load(sys.stdin)["runtimes"] if r["isAvailable"] and r["platform"]=="iOS"]
print(sorted(rs,key=lambda r:[int(x) for x in r["version"].split(".")])[-1]["identifier"])')
  DEVICE_TYPE=$(xcrun simctl list devicetypes -j | python3 -c '
import json,sys
ts=[t["identifier"] for t in json.load(sys.stdin)["devicetypes"] if "iPhone" in t["name"]]
pick=[t for t in ts if t.endswith("iPhone-17")] or ts
print(pick[-1])')
  UDID=$(xcrun simctl create "jarvis3-e2e" "$DEVICE_TYPE" "$RUNTIME")
  echo "simulator $UDID ($DEVICE_TYPE, $RUNTIME)"
  xcrun simctl boot "$UDID"
  echo "$UDID" > "$UDID_FILE"
}

if [[ "${1:-}" == "--boot" ]]; then
  create_and_boot
  exit 0
fi

APP="$1"
: "${JARVIS3_BUNDLE_ID:?missing}"

# The mock instance on :8090 (the URL baked into this build).
(cd "$HERE/.." && nohup node --import tsx e2e-jarvis3/mock-instance.ts --port 8090 > "$OUT/mock-instance.log" 2>&1 &)
for _ in $(seq 60); do curl -sf http://127.0.0.1:8090/api/health > /dev/null && break; sleep 1; done
curl -sf http://127.0.0.1:8090/api/health

if [[ -s "$UDID_FILE" ]]; then UDID=$(cat "$UDID_FILE"); else create_and_boot; fi
SECONDS=0
xcrun simctl bootstatus "$UDID" -b > /dev/null
echo "simulator $UDID booted (waited ${SECONDS}s)"
xcrun simctl install "$UDID" "$APP"
nohup xcrun simctl spawn "$UDID" log stream --style compact --level info \
  --predicate "subsystem CONTAINS \"com.facebook.react\" OR process CONTAINS \"Jarvis\"" > "$OUT/sim.log" 2>&1 &

# A slow runner can take minutes to boot the simulator and then to start Maestro's XCTest driver
# (default wait 2 min: "iOS driver not ready in time"), so wait longer and give the first flow a
# second attempt; it starts from a clean install state either way.
export MAESTRO_DRIVER_STARTUP_TIMEOUT=300000
status=0
for attempt in 1 2; do
  status=0
  maestro --device "$UDID" test --test-output-dir "$OUT/pair-$attempt" -e APP_ID="$JARVIS3_BUNDLE_ID" \
    "$HERE/maestro/pair.yaml" || status=$?
  [[ $status -eq 0 ]] && break
done
if [[ $status -eq 0 ]]; then
  maestro --device "$UDID" test --test-output-dir "$OUT/relaunch" -e APP_ID="$JARVIS3_BUNDLE_ID" \
    "$HERE/maestro/relaunch.yaml" || status=$?
fi
xcrun simctl io "$UDID" screenshot "$OUT/final.png" || true
xcrun simctl shutdown "$UDID" || true
xcrun simctl delete "$UDID" || true
exit $status
