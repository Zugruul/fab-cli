# fab-app

React Native (TypeScript), iOS-first FAB companion app described in `../SPEC-APP.md` §9
onward: on-device Q&A over the FAB knowledge corpus (llama.rn + op-sqlite/sqlite-vec
retrieval), card scanning (react-native-vision-camera + react-native-fast-tflite), and an
offline catalog with QR/BC-UR sharing.

This package is the APP-030 scaffold: RN 0.86.2 project (generated via
`@react-native-community/cli init`), the four native pillars wired in, and a device smoke
screen (`src/smokeScreen/`) that exercises all four. #217 added the app-language layer
(English + Brazilian Portuguese — see "Language (i18n)" below). Everything else beyond the
scaffold + smoke screen (Q&A, scanning, catalog, artifact manager) is later work per
`SPEC-APP.md` §9.2 onward.

## Dev

```bash
pnpm install            # from the monorepo root — see "Monorepo + pnpm" below
cd fab-app
npm run typecheck       # tsc --noEmit
npm run lint            # eslint .
npm run test            # jest (native modules mocked — see "Testing" below)
npm run gate            # typecheck && lint && test — what CI/the root gate runs
npm run start           # Metro bundler
npm run ios             # build + run on a booted simulator/device (not run in CI)
```

## Monorepo + pnpm

fab-app is a workspace package (`../pnpm-workspace.yaml`) alongside `fab-cli` and `pipeline`.
React Native's autolinking (CocoaPods/Gradle) and some native modules' own install scripts —
notably op-sqlite's podspec, which walks up from `node_modules/@op-engineering/op-sqlite`
looking for the nearest `package.json` to read its `"op-sqlite"` config block — assume a flat,
npm-style `node_modules` they can walk with plain filesystem paths. pnpm's default "isolated"
linker uses a symlink farm into a shared content-addressable store (`.pnpm/`) that those
scripts don't understand.

**The fix: `node-linker=hoisted` in the monorepo root's `.npmrc`** (`../.npmrc`), which makes
pnpm lay out a single flat, real (non-symlinked) `node_modules` at the workspace root — the
same shape `npm`/`yarn classic` would produce. We first tried scoping this to a
`fab-app/.npmrc` only (since fab-app is the only package with native RN dependencies, leaving
fab-cli/pipeline on pnpm's default isolated linker) — pnpm does support per-project `.npmrc`
for most settings, but `node-linker` specifically is computed for the whole workspace during a
root-level `pnpm install` (the install path required by APP-030's acceptance criteria), so the
per-project file was silently ignored. It has to live at the workspace root.

**Effect on op-sqlite's config lookup:** with everything hoisted to the workspace root, walking
up from `<root>/node_modules/@op-engineering/op-sqlite` reaches `<root>/package.json`
first — so the `"op-sqlite": { "sqliteVec": true }` config block lives in the **monorepo
root** `package.json`, not `fab-app/package.json` (confirmed by `pod install`'s
`[OP-SQLITE] using Sqlite Vec` log line).

**Effect on fab-cli:** hoisting is workspace-wide, so fab-cli/pipeline's `node_modules` also
became flat. This only broke one thing: `fab-cli/bin/fab.js` loaded tsx via a hardcoded
`../node_modules/tsx/dist/cjs/api/index.cjs` relative path, which no longer resolved once tsx
moved to the root `node_modules`. Fixed to use tsx's public `tsx/cjs/api` export instead (see
that file's comment) — this is more portable, not a functional change, and fab-cli's full gate
(621 tests) still passes.

**Nitro peer dependencies:** react-native-vision-camera, op-sqlite, and react-native-fast-tflite
are all built on [Nitro Modules](https://nitro.margelo.com/), and each declares
`react-native-nitro-modules` as a peer dependency (vision-camera also needs
`react-native-nitro-image`). RN's autolinking only scans a package's own direct
`dependencies`, not arbitrary transitively-installed peers, so these are declared explicitly in
`fab-app/package.json` even though nothing in fab-app's own code imports them directly —
omitting them makes `pod install` fail with `Unable to find a specification for NitroModules`.

## The four native pillars

| Package | Role | Smoke check (`src/smokeScreen/checks.ts`) |
|---|---|---|
| `llama.rn` | on-device LLM inference (Q&A) | `installJsi()` only — no model load; reports `llama.cpp` build info |
| `@op-engineering/op-sqlite` (+ sqlite-vec) | retrieval index storage | opens an in-memory DB, creates a `vec0` virtual table, inserts + queries one vector |
| `react-native-vision-camera` | card scanning | requests camera permission, reports discovered devices (`SmokeScreen.tsx`, hook-based) |
| `react-native-fast-tflite` | on-device card-detector inference | confirms the module's `loadTensorflowModel` export loads (no bundled model yet) |

## Language (i18n)

`src/i18n/` (#217, `../SPEC-APP.md` §9.11) provides a **registered set of shipped locales** —
currently English (`en`, source of truth) and Brazilian Portuguese (`pt-BR`) — for every
user-facing UI string in the app. This is a set, not a hardcoded pair: the gate's key-parity
check and the per-locale screen tests iterate whatever's registered, so adding a locale is a
data change (new bundle + one registry line), not a code change to any check or test. The
knowledge corpus, retrieval results, and model answers (§10 onward) stay English-only in this
version — this is UI chrome only. Framework: [react-i18next](https://react.i18next.com/) — both
react-i18next and Lingui work fully offline with bundles compiled into the JS bundle, but
react-i18next needed no extra build tooling (Lingui's message catalogs need their own compile
step) and its `useTranslation()`/`t()` API composes directly with plain JSON resource bundles
and `react-test-renderer`, which is what this repo's screen tests already use.

- **Locale registry**: `src/i18n/locales/index.ts` — `LOCALE_BUNDLES` (locale code → imported
  JSON bundle) is the single source of truth; `Locale` is derived from its keys
  (`keyof typeof LOCALE_BUNDLES`), `SOURCE_LOCALE` (`en`) and `SUPPORTED_LOCALES` are derived
  from it too. **To add a locale**: drop `locales/<code>.json` next to `en.json`/`pt-BR.json`,
  import it, add one entry to `LOCALE_BUNDLES` — i18next's resources, the key-parity gate check,
  and every parametrized screen test pick it up automatically.
- **Locale resolution**: `src/i18n/resolveLocale.ts` — an explicit manual override wins; else
  the device/system locale is mapped via `src/i18n/systemLocale.ts` (reads
  `Intl.DateTimeFormat().resolvedOptions().locale`, no new native module — deliberately not
  `react-native-localize`, which the jest gate can't exercise) to the closest registered locale
  (currently: any `pt-*` locale → `pt-BR`, everything else → the source locale, `en`) — this
  per-locale-family mapping is inherently locale-specific business logic, not something the
  registry can derive generically.
- **Manual override**: persisted on-device via `src/i18n/languageStore.ts`, backed by
  `@op-engineering/op-sqlite` (already a dependency — no new native module) in
  `src/i18n/defaultLanguagePreferenceStore.ts`. `App.tsx` renders `LanguageSwitcher` above the
  smoke screen — one option per `SUPPORTED_LOCALES` entry plus "system"; tapping an option
  persists the choice and switches the running UI language immediately, no reinstall. Per user
  directive, this surface (and all app UI for now) is intentionally bare-minimum — default RN
  components, no styling — pending a dedicated UI-refinement task once functionality exists.
- **App start sequence**: `I18nProvider` resolves the system locale synchronously (so first
  paint is already correct for anyone who's never set an override) and applies a persisted
  override shortly after mount, once the single async db read resolves — see the top-of-file
  comment in `src/i18n/I18nProvider.tsx` for the one-render-at-system-locale tradeoff this
  implies for a returning user with a saved override.
- **Gate enforcement** (both run inside `npm run gate`, offline, generically over
  `SUPPORTED_LOCALES` — not a hardcoded en/pt-BR pair):
  - **No hardcoded literals**: `.eslintrc.js`'s `react/jsx-no-literals` override (an existing
    transitive dependency of `@react-native/eslint-config` — no new package), scoped to
    `App.tsx` + `src/**/*.tsx`, excluding test files (fixture text in a test isn't shipped UI
    copy). Exercised end to end by `src/i18n/__tests__/noHardcodedJsxLiterals.test.ts`, which
    runs the project's real ESLint config against fixtures.
  - **Key parity**: `checkAllLocalesParity()` in `src/i18n/checkParity.ts` checks every
    non-source locale in `LOCALE_BUNDLES` against `SOURCE_LOCALE`, exercised by
    `src/i18n/__tests__/checkParity.test.ts` against both fixtures and the real shipped
    bundles — a PR that adds a source key without its translation in *any* registered locale
    fails this test.
  - **Screen tests**: each in-scope screen's test file parametrizes its translated-copy
    assertions with `describe.each(SUPPORTED_LOCALES)`, asserting against that locale's own
    bundle content (`LOCALE_BUNDLES[locale]`) rather than a hardcoded translated string — so a
    locale added to the registry is covered automatically.
- **Consent-screen translation** (`src/onboarding/screens/ConsentScreen.tsx`): translated
  faithfully, but each non-source locale's legal/consent text needs a human legal/content review
  before release — a named release gate (like the §9.10 TestFlight pipeline), not something the
  merge gate substitutes for.

## Testing

`npm run test` runs Jest with all four native packages replaced by hand-written stubs
(`jest.config.js`'s `moduleNameMapper` → `__mocks__/`) — none of them have a real native
binding available in a headless CI/jest environment (no simulator/device), so this is required
for the suite to run at all, not just a nicety. Unit tests cover the pure smoke-screen state
machine (`src/smokeScreen/reducer.test.ts`, `summary.test.ts`) and a light render smoke test
(`__tests__/App.test.tsx`) — note `react-native-safe-area-context`'s `SafeAreaProvider` renders
null children under jest (no native initial-insets event fires headlessly), so that test can
only assert `App()` mounts without throwing, not on rendered content; screen-level content
(including translated output in both locales) is asserted directly in each screen's own test
file instead.

**The device smoke test itself (SPEC-APP.md §9.1, §15 "Device (release-gating,
manual/scripted)") is not part of this suite and is not run in CI.** It's a manual, human-run
check on real hardware via the APP-036 TestFlight pipeline — this environment is headless with
no simulator/device available. `SmokeScreen.tsx` renders a "Device run: pending human device
test via the APP-036 TestFlight pipeline" note for exactly this reason.

## iOS

```bash
cd fab-app/ios
pod install
```

Generates `FabApp.xcworkspace` with all four native pillars (+ their Nitro dependencies)
linked — verify with `grep -c '^\s*- ' Podfile.lock` or by opening the workspace in Xcode.
Not run as part of `npm run gate` (native builds are slow and this repo's gate must stay fast
and network-off per `../SPEC-APP.md` invariant 10).

## Android

The generated `android/` project is left as-is from the RN template (untouched beyond what
`@react-native-community/cli init` produced) so Android stays viable per NG7, but it hasn't
been built or exercised here — this environment has no emulator and APP-030 is iOS-first.

## License

MIT (see `LICENSE`). Per the monorepo's GPL isolation rule (`../SPEC-APP.md` §6.7), fab-app
must never declare a dependency on `fab-cli` in any form — enforced structurally by
`../scripts/workspace.test.mjs`.
