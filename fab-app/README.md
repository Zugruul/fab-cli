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

## Accessibility

`src/a11y/` (#218, `../SPEC-APP.md` §9.12) gate-enforces that every interactive element in shipped
UI is usable by VoiceOver/TalkBack — the same "structurally impossible to merge, not just review-
caught" pattern §9.11 established for untranslated strings, generic over whatever screens/elements
currently exist rather than a hardcoded per-screen list:

- **Lint**: `.eslintrc.js`'s `plugin:react-native-a11y/basic` override, scoped to `App.tsx` +
  `src/**/*.tsx` and excluding test files (mirrors the #217 no-hardcoded-literals override's
  scoping — fixture elements in tests are sample data, not shipped UI). `basic` (not
  `ios`/`android`/`all`) was chosen because it's the WCAG-informed core common to both platforms
  (accessible name, role, hint, actions, state, value, no nested touchables) without pulling in
  platform-specific extras this app doesn't need yet (e.g. `ios`'s
  `accessibilityIgnoresInvertColors` rule, which only applies once a screen has an `<Image>`) —
  those can be added incrementally once a screen actually needs them, rather than forcing
  preemptive props on elements that don't exist. Exercised end to end by
  `src/a11y/__tests__/a11yLintGate.test.ts`, which runs the project's real ESLint config against
  fixtures (mirrors `noHardcodedJsxLiterals.test.ts`).
- **Runtime tree walk**: `src/a11y/assertAccessibleTree.ts` walks a rendered
  `react-test-renderer` tree for every interactive RN primitive (`Touchable*`, `Pressable`,
  `Switch`, `TextInput`) and asserts each has a resolvable accessible name (an explicit
  `accessibilityLabel`, resolved nested `Text` content, or — `TextInput` only — its `placeholder`)
  and, where RN doesn't already guarantee one structurally (`Switch` defaults its role; bare
  `Touchable*`/`Pressable` do not), an explicit `accessibilityRole`/`role`. RN's own `<Button>`
  needs no special case — it always composes into a `Touchable` the walker already checks (see
  the module's top comment for why). `src/a11y/__tests__/screens.a11y.test.tsx` applies this to
  every current screen (ConsentScreen, FeatureGate, ProgressScreen, ProvenanceScreen, SmokeScreen,
  LanguageSwitcher) across every registered locale, via a small registration table — adding a
  future screen only means adding an entry there, never new check logic. The walker's own
  correctness (both directions — passes wired elements, flags unwired ones) is proven by
  `src/a11y/__tests__/assertAccessibleTree.test.tsx`.
- **Audit findings fixed by this task**: `ConsentScreen`'s two `TouchableOpacity` controls and
  `ProgressScreen`'s pause/resume/retry controls had no `accessibilityRole` at all;
  `LanguageSwitcher`'s per-option rows had `accessibilityState` but no role (now `"radio"`,
  matching their existing selected-state semantics). `SmokeScreen`'s `Button`, `FeatureGate`, and
  `ProvenanceScreen` needed no changes — `Button` composes into an already-compliant `Touchable`,
  and the other two have no interactive elements of their own.
- **What this can't check**: automated tree/lint checks can't verify what a real screen reader
  actually announces, in what order, or Dynamic Type/font-scale layout survival. See
  `docs/a11y-manual-qa.md` for the manual VoiceOver/TalkBack device-QA checklist (per current
  screen) — a named human release gate consumed by APP-036's TestFlight device QA, the same way
  §9.11's consent-text translation review is a human release gate the merge gate doesn't
  substitute for.

## Theming

`src/theme/` (#219, `../SPEC-APP.md` §9.13) follows the device's OS-level light/dark setting — no
in-app toggle in this version. Same pattern one level up from #217/#218: a registered, data-driven
token set (not a hardcoded pair), a lint rule, and a gate check with no per-screen check logic.

- **Token roles**: `src/theme/tokens.ts`'s `THEMES` registry (`light`/`dark`, `THEME_NAMES`) —
  `background` (primary surface), `surface` (secondary/elevated surface — provisioned for future
  card-style UI; no current screen has a distinct card look yet, so it isn't visually
  differentiated from `background` in v1's flat containers), `text` (primary content),
  `mutedText` (de-emphasized/secondary content — consolidates several near-identical ad hoc grays
  the six screens used before this task, `#333333`/`#555555`/`#666666`/`#888888`, into one
  coherent role), `border` (decorative hairline separators), `accent` (call-to-action text),
  `danger`/`warning`/`success` (status tones — SmokeScreen's per-module check states, plus
  ProgressScreen's error text). Every one of the nine per-theme colors individually clears WCAG AA
  (4.5:1) against both `background` and `surface`.
- **Consuming tokens**: `useTheme()` (`src/theme/useTheme.ts`) resolves `{name, tokens}` from RN's
  `useColorScheme()` every render — no Provider/context needed (unlike #217's i18n layer, which
  needs one for its async persisted-preference read; theme is a pure synchronous system read with
  no persisted override). Screens build their `StyleSheet` from `tokens` inside a
  `useMemo(() => createStyles(tokens), [tokens])`, since `StyleSheet.create()` itself is a
  module-scope call and can't see a hook's value directly. `App.tsx`'s `StatusBar` `barStyle` folds
  into the same `useTheme()` call instead of computing `useColorScheme() === 'dark'` on its own.
- **Live updates**: `useColorScheme()` is backed by React's `useSyncExternalStore` subscribed to
  RN's `Appearance` change listener, so a system appearance change re-renders every component that
  calls `useTheme()` automatically — no extra wiring in this layer. Proven in
  `src/theme/__tests__/useTheme.test.tsx` by mocking `useColorScheme`'s return value and
  re-rendering (see that file's top comment for why a Proxy-based mock is used instead of spreading
  the whole `react-native` module — spreading eagerly evaluates every lazy getter on RN's index,
  including native-module-backed ones, which throws under jest's headless environment).
- **Gate enforcement** (both run inside `npm run gate`, offline, generically over `THEME_NAMES` and
  the token-pair table — not a hardcoded light/dark or role pair):
  - **No hardcoded color literals**: `.eslintrc.js`'s `react-native/no-color-literals` override
    (an existing transitive dependency of `@react-native/eslint-config`, already registered in
    that config's `plugins` array — no new package), scoped identically to the #217/#218
    overrides: `App.tsx` + `src/**/*.tsx`, test files excluded. Distinct from the base config's
    own `react-native/no-inline-styles` (a perf-motivated rule, unrelated to theming, left
    untouched). Exercised end to end by
    `src/theme/__tests__/noHardcodedColorLiterals.test.ts`, which runs the project's real ESLint
    config against fixtures (mirrors `noHardcodedJsxLiterals.test.ts`/`a11yLintGate.test.ts`).
  - **Token contrast**: `checkTokenContrast()` in `src/theme/tokenContrastGate.ts` checks every
    pair in `CONTRAST_PAIRS` (12 foreground-role-on-background-role pairs actually rendered by
    shipped screens — `border` is decorative-only and intentionally excluded, WCAG's text-contrast
    rule doesn't apply to it) against every theme in `THEME_NAMES`, via a pure, independently
    unit-tested WCAG contrast-ratio function (`src/theme/contrast.ts` — relative luminance +
    contrast ratio, no dependency). Exercised by `src/theme/__tests__/contrast.test.ts` (the math
    itself, against hand-computed reference ratios) and
    `src/theme/__tests__/tokenContrastGate.test.ts` (the gate check, against fixtures including a
    deliberately broken one, plus the real shipped `THEMES`).
  - **Per-screen rendering**: `src/a11y/__tests__/screenRegistry.tsx` (extracted from #218's
    `screens.a11y.test.tsx` so both suites reuse one registration table) backs two checks —
    `screens.a11y.test.tsx` itself now runs its accessibility walk across a theme x locale matrix
    (both dimensions data-driven, so the extra dimension is cheap), and
    `src/theme/__tests__/screens.theme.test.tsx` asserts every registered screen renders under
    both themes without throwing. A future screen only needs registering once, in one place —
    never new check logic in either suite.
- **Audit findings fixed by this task**: every hardcoded color literal in `fab-app/src` + `App.tsx`
  — `ProvenanceScreen`, `SmokeScreen`, `ConsentScreen`, `FeatureGate`, `ProgressScreen` (a mix of
  `StyleSheet.create()` hex literals for text/status/border colors). `LanguageSwitcher` has none
  (per user directive it's intentionally unstyled, default RN components only) and was left
  untouched. Titles/labels that previously had no explicit color (relying on the platform default,
  effectively black) now read `tokens.text` explicitly — without that, dark mode would leave black
  text on a dark background. Light-mode visual output is unchanged: `background` is `#ffffff`,
  `text` is `#000000`, matching what an unset color already rendered as.
- **In-app theme toggle**: out of scope for v1 per user directive ("no in-app toggle unless
  trivially cheap"). Building one on top of a persisted-preference store analogous to
  `src/i18n/languageStore.ts` (same `@op-engineering/op-sqlite` backing, same override-vs-system
  resolution shape) would be straightforward to add later, but isn't "trivially cheap" *on top of*
  this task — it needs its own persistence layer, a settings-surface entry, and its own gate
  coverage — so it's deferred rather than bundled in here.

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

## Distribution

`npm run testflight` runs a one-command archive → export → upload to TestFlight (App Store
Connect API key auth, cloud-managed signing, no Xcode GUI sign-in required). See
[`docs/ios-distribution.md`](docs/ios-distribution.md) for required env vars, adding a new
internal tester, and troubleshooting. Not part of `npm run gate` — same "native builds are slow
and the gate stays network-off" reasoning as the iOS section above.

## License

MIT (see `LICENSE`). Per the monorepo's GPL isolation rule (`../SPEC-APP.md` §6.7), fab-app
must never declare a dependency on `fab-cli` in any form — enforced structurally by
`../scripts/workspace.test.mjs`.
