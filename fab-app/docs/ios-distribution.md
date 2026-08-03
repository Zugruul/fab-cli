# iOS distribution (TestFlight)

Covers #144 / APP-036 (SPEC-APP.md §9.10): the iOS distribution pipeline — Apple Developer app
record + bundle id, code signing/provisioning, an automated build-and-upload path to TestFlight,
and a documented device-test provisioning flow. This is the channel every on-device acceptance
criterion elsewhere in the spec (device smoke test, VoiceOver/TalkBack QA, etc.) runs through.

## App record

- Bundle id: `io.fabcollections`
- App Store Connect app: **FaB Collections**, Apple ID `6797303392`
- Display name (`CFBundleDisplayName`): "FaB Collections"

## Running the one-command release

```bash
cd fab-app
npm run testflight
```

This runs `scripts/testflight-release.sh`, which:

1. Preflight-checks the App Store Connect API credentials (see below) and that `ios/` has a
   `Pods/` directory (runs `pod install` first if not).
2. Archives the `Release` configuration for `generic/platform=iOS`
   (`xcodebuild archive`), with cloud-managed ("Automatic") code signing via
   `-allowProvisioningUpdates` + the API key — no Xcode Accounts sign-in and no local
   certificates/provisioning profiles required.
3. Generates an `ExportOptions.plist` targeting App Store Connect directly
   (`method: app-store-connect`, `destination: upload` — the unified Xcode 15+
   `-exportArchive` flow that exports *and* uploads in one step, no `altool`/`notarytool`).
4. Runs `xcodebuild -exportArchive` to export + upload the build to App Store Connect.
5. Checks the App Store Connect API for the newly-visible build (processing state).

Every step's log is written to `fab-app/.testflight/<timestamp>/` (gitignored — logs, the
`.xcarchive`, the exported `.ipa`, and the generated `ExportOptions.plist` never get committed).
`xcodebuild` output is piped through a redaction filter before it's written to disk or the
console, so the key path (and any bearer token minted for the App Store Connect API check) never
appears in a log even if a future xcodebuild change starts printing more verbose auth details.

The **first** archive is slow — this app links four native pillars (`llama.rn`, `op-sqlite`,
`react-native-vision-camera`, `react-native-fast-tflite`) and a from-scratch native build can
take 10–30 minutes. Subsequent runs are faster (incremental build).

### Environment variables

| Var | Required | Default | Notes |
|---|---|---|---|
| `ASC_KEY_ID` | yes | `4ZCWK2K2RT` | App Store Connect API key ID |
| `ASC_ISSUER_ID` | yes | `d65634cb-5a37-4eba-9cba-cbf12d2aec45` | App Store Connect API issuer ID |
| `ASC_KEY_PATH` | yes | `~/.appstoreconnect/private/AuthKey_$ASC_KEY_ID.p8` | path to the `.p8` private key — **never commit this file** |
| `ASC_TEAM_ID` | no | — | Apple Developer Team ID; only needed if the API key's account belongs to more than one team (a single-team account resolves automatically) |
| `BUNDLE_ID` | no | `io.fabcollections` | overrides the bundle id used for the archive + App Store Connect lookups |

The three required vars all have this project's registered defaults baked in, so on a machine
that already has the `.p8` key at the default path, a bare `npm run testflight` works with no
env vars set at all.

**The `.p8` key is a secret.** It's never read into git, never printed by the script, and should
live only at `~/.appstoreconnect/private/` (outside any repo checkout).

## Adding a new test device / tester

TestFlight **internal testers do not need UDID device registration** — that's only required for
ad hoc distribution outside TestFlight. To add a new internal tester:

1. Go to [App Store Connect](https://appstoreconnect.apple.com/) → **My Apps** → **FaB
   Collections** → **TestFlight**.
2. Under **Internal Testing**, open the testing group (created by this pipeline if it didn't
   already exist — see below) or create one.
3. Click **+** next to **Testers** and add the tester by their **Apple ID email address**. They
   must already be a user on the App Store Connect team (internal testers are pulled from your
   team's Users and Access list, up to 100 testers per team) — add them there first
   (**Users and Access** → **+**) if they aren't yet.
4. The tester receives an email/TestFlight-app invite. Once accepted, any build assigned to that
   group (internal groups get automatic access to all new builds with no extra review step)
   installs directly from the TestFlight app on their device — no UDID, no ad hoc profile, no
   manual provisioning step on either side.

External testers (not needed for the two floor devices this task targets) go through a separate
flow that does require a Beta App Review — out of scope here.

## Troubleshooting

- **"preflight failed" / missing env var**: one of `ASC_KEY_ID`/`ASC_ISSUER_ID`/`ASC_KEY_PATH`
  isn't set and has no usable default, or the `.p8` file isn't at the resolved path. Set the var
  or move the key to the default location.
- **Archive step fails with a signing/provisioning error**: this pipeline uses fully automatic
  ("cloud") signing — `xcodebuild` should create/download certificates and profiles itself via
  `-allowProvisioningUpdates`. If it still fails:
  - Confirm the API key has at least the **App Manager** role in App Store Connect (**Admin**
    also works; **Developer**-only keys can't manage provisioning).
  - If the account behind the key belongs to more than one Apple Developer team, set
    `ASC_TEAM_ID` explicitly (Xcode/xcodebuild can't guess which team otherwise).
  - A step that genuinely requires interactive Xcode GUI/keychain access (rare, but possible on
    a brand-new machine with no prior Xcode sign-in at all) can't be automated by this script —
    if you hit one, the exact xcodebuild error is printed and logged; that's a one-time manual
    Xcode step, not a bug in the pipeline.
- **Export/upload step fails**: check `fab-app/.testflight/<timestamp>/export-upload.log`.
  Common causes: the archive's bundle id doesn't match an app record in App Store Connect (should
  not happen here — `io.fabcollections` is set at the project level and again passed explicitly
  at archive time), or the build number was already used by a prior upload (shouldn't happen
  either — see below).
- **Build number conflicts**: the export options set `manageAppVersionAndBuildNumber: true`
  (Xcode's default since Xcode 13), so Xcode validates/increments `CFBundleVersion` against what
  App Store Connect has already seen for this bundle id + version, automatically. There's no
  manual build-number bookkeeping (`agvtool` or otherwise) to maintain.
- **Build not visible yet in App Store Connect / still "processing"**: normal — Apple's build
  processing (virus scan, export compliance check, symbol/ICU validation) typically takes
  several minutes to a couple of hours after a successful upload before the build is assignable
  to a testing group. The script's final `verify-build` check reports whatever processing state
  is visible at the time it runs; re-check App Store Connect directly if it's still "Processing".
- **Export compliance**: the first build for a new app version may prompt for an export
  compliance answer in App Store Connect (uses encryption: no, for this app) before it can be
  distributed to testers — a one-time manual step per version if Apple doesn't infer it
  automatically from the archive.
