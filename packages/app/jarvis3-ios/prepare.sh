#!/usr/bin/env bash
# Generates the iOS project of the jarvis3 variant and installs pods. Run from anywhere on macOS
# after `npm ci`. Env: JARVIS3_INSTANCE_URL, JARVIS3_BUNDLE_ID, JARVIS3_APP_NAME (app.config.js),
# BUILD_NUMBER (CFBundleVersion, optional). Prints nothing secret.
# Writes the generated project name (e.g. Jarvis3) to ios/.jarvis3-name (Expo names it after the app).
set -euo pipefail
cd "$(dirname "$0")/../../.."
export APP_VARIANT=jarvis3 CI=1
: "${JARVIS3_INSTANCE_URL:?missing}" "${JARVIS3_BUNDLE_ID:?missing}"

npm run build:app-deps
npm run build:terminal-webview --workspace=@getpaseo/app

cd packages/app
npx expo prebuild --platform ios --no-install --clean
PROJECT=$(cd ios && ls -d *.xcodeproj | head -1) # the .xcworkspace appears only after pod install
NAME=${PROJECT%.xcodeproj}
PLIST="ios/$NAME/Info.plist"
if [[ -n "${BUILD_NUMBER:-}" ]]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${BUILD_NUMBER}" "$PLIST"
fi
echo "bundle id: $(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PLIST" 2>/dev/null || true) (project $NAME)"
/usr/libexec/PlistBuddy -c 'Print :CFBundleURLTypes' "$PLIST" | grep -E '^\s+[a-z0-9.-]+$' | sed 's/^ */url scheme: /'
echo "NODE_BINARY=$(command -v node)" > ios/.xcode.env.local
(cd ios && pod install)
echo "$NAME" > ios/.jarvis3-name
