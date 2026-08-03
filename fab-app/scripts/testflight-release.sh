#!/usr/bin/env bash
# One-command iOS TestFlight release pipeline (#144 APP-036, SPEC-APP.md
# §9.10) — the channel every on-device acceptance criterion in the app spec
# runs through. Archives the Release configuration, then exports AND
# uploads straight to App Store Connect in a single xcodebuild step (the
# unified Xcode 15+ export/upload flow — no altool/notarytool/fastlane)
# using API-key authentication + cloud-managed ("Automatic") signing, so it
# runs headlessly with no Xcode Accounts sign-in required.
#
# Usage: npm run testflight   (from fab-app/), or run this script directly.
#
# Required env (documented in docs/ios-distribution.md):
#   ASC_KEY_ID         App Store Connect API key ID
#   ASC_ISSUER_ID      App Store Connect API issuer ID
#   ASC_KEY_PATH       path to the .p8 private key
#     (all three default to this project's registered key — see below —
#     so a bare `npm run testflight` works out of the box on a machine that
#     has the key at the default path)
# Optional env:
#   ASC_TEAM_ID   Apple Developer Team ID — only needed if the API key's
#                 account belongs to more than one team; xcodebuild resolves
#                 a single-team account automatically
#   BUNDLE_ID     defaults to io.fabcollections
#
# Never echoes secrets: xcodebuild output is piped through the same
# redactSecrets() helper the jest suite covers (scripts/testflight/lib.ts)
# before it ever reaches a log file or the terminal. The .p8 key's contents
# are never read by this script — only its path is handed to xcodebuild.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

: "${ASC_KEY_ID:=4ZCWK2K2RT}"
: "${ASC_ISSUER_ID:=d65634cb-5a37-4eba-9cba-cbf12d2aec45}"
: "${ASC_KEY_PATH:=$HOME/.appstoreconnect/private/AuthKey_${ASC_KEY_ID}.p8}"
: "${BUNDLE_ID:=io.fabcollections}"
export ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH BUNDLE_ID

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "testflight-release: xcodebuild not found on PATH — install/select Xcode first" >&2
  exit 1
fi

TSX_BIN="$APP_DIR/node_modules/.bin/tsx"
if [ ! -x "$TSX_BIN" ]; then
  echo "testflight-release: node_modules/.bin/tsx not found — run 'pnpm install' first" >&2
  exit 1
fi
CLI=("$TSX_BIN" "$SCRIPT_DIR/testflight/cli.ts")

echo "==> Preflight checks"
if ! "${CLI[@]}" check-env; then
  echo "testflight-release: preflight failed (see above) — aborting" >&2
  exit 1
fi

WORKSPACE="$APP_DIR/ios/FabApp.xcworkspace"
if [ ! -d "$WORKSPACE" ]; then
  echo "testflight-release: workspace not found at $WORKSPACE" >&2
  exit 1
fi

if [ ! -d "$APP_DIR/ios/Pods" ]; then
  echo "==> Pods not installed, running pod install"
  ( cd "$APP_DIR/ios" && { bundle exec pod install || pod install; } )
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="$APP_DIR/.testflight/$TIMESTAMP"
mkdir -p "$RUN_DIR"
echo "==> Logs + build artifacts: $RUN_DIR"

ARCHIVE_PATH="$RUN_DIR/FabApp.xcarchive"
EXPORT_OPTIONS_PLIST="$RUN_DIR/ExportOptions.plist"
EXPORT_PATH="$RUN_DIR/export"

AUTH_ARGS=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
TEAM_BUILD_ARGS=()
PLIST_ARGS=(--method app-store-connect --destination upload)
if [ -n "${ASC_TEAM_ID:-}" ]; then
  TEAM_BUILD_ARGS+=("DEVELOPMENT_TEAM=$ASC_TEAM_ID")
  PLIST_ARGS+=(--team-id "$ASC_TEAM_ID")
fi

echo "==> Archiving Release configuration (first native build can take 10-30 minutes)"
if ! xcodebuild archive \
  -workspace "$WORKSPACE" \
  -scheme FabApp \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE_PATH" \
  -allowProvisioningUpdates \
  "${AUTH_ARGS[@]}" \
  CODE_SIGN_STYLE=Automatic \
  PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" \
  "${TEAM_BUILD_ARGS[@]}" \
  2>&1 | "${CLI[@]}" redact --secret "$ASC_KEY_PATH" | tee "$RUN_DIR/archive.log"; then
  echo "testflight-release: archive step failed — see $RUN_DIR/archive.log" >&2
  exit 1
fi

echo "==> Generating export options plist"
"${CLI[@]}" export-options-plist "${PLIST_ARGS[@]}" > "$EXPORT_OPTIONS_PLIST"

echo "==> Exporting + uploading to App Store Connect"
if ! xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS_PLIST" \
  -exportPath "$EXPORT_PATH" \
  -allowProvisioningUpdates \
  "${AUTH_ARGS[@]}" \
  2>&1 | "${CLI[@]}" redact --secret "$ASC_KEY_PATH" | tee "$RUN_DIR/export-upload.log"; then
  echo "testflight-release: export/upload step failed — see $RUN_DIR/export-upload.log" >&2
  exit 1
fi

echo "==> Upload complete. Logs + artifacts: $RUN_DIR"
echo "==> Checking build visibility in App Store Connect (processing can take several minutes)"
"${CLI[@]}" verify-build --bundle-id "$BUNDLE_ID" || echo "testflight-release: verification check failed — inspect App Store Connect manually" >&2
