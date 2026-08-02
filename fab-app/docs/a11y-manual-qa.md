# Manual accessibility QA (VoiceOver / TalkBack)

SPEC-APP.md §9.12. The automated a11y gate (`npm run gate` — see `../README.md`'s
"Accessibility" section) proves every interactive element has a resolvable accessible name and
role in the render tree; it cannot verify what a real screen reader actually announces, in what
order, or whether the layout survives Dynamic Type / large-font settings. That's this checklist's
job — a human running the app on real hardware. APP-036's TestFlight device-QA pass (per
`../SPEC-APP.md` §9.10) consumes this checklist alongside the existing device smoke test
(`../src/smokeScreen/`).

Run on: one iOS device with VoiceOver, one Android device with TalkBack (or an equivalent
simulator/emulator run, noting it's not a substitute for real hardware before a release).

## How to run

1. Enable the platform screen reader (iOS: Settings → Accessibility → VoiceOver; Android:
   Settings → Accessibility → TalkBack).
2. For each screen below, walk it with the screen reader's standard swipe-to-next-element
   gesture (do not tap-to-select — that skips elements a real user's swipe order would hit).
3. Record pass/fail per checkpoint. A screen fails the checklist if either screen reader misses
   an interactive control, announces a control with no meaningful name ("button" with nothing
   else), or announces a name/role that doesn't match what the control does.
4. Repeat with the device's largest Dynamic Type / font-scale setting enabled, to catch layout
   breakage (see "Dynamic-type non-breakage" per screen below) — this is a second full pass, not
   an afterthought at the end.

## What to check, per screen

### ConsentScreen (`src/onboarding/screens/ConsentScreen.tsx`)

- **Focus order**: title → model/knowledge/total size rows → (state-dependent) waiting notice,
  or cellular warning + its override button, or the accept button. Order should read top-to-
  bottom matching visual layout.
- **Labels announced**: each size row reads its full sentence (not just the byte count); the
  cellular-warning and accept controls read their button text.
- **Roles announced**: the override and accept controls both announce as "button".
- **State announced**: N/A (no toggle/selection state on this screen).
- **Touch-target adequacy**: both buttons are comfortably tappable (≥ 44×44pt) without
  overlapping the size-row text above them.
- **Dynamic-type non-breakage**: size text and button labels wrap or scale without being
  truncated or overlapping; the ScrollView remains scrollable to reach the button at the
  largest font size.

### FeatureGate (`src/onboarding/screens/FeatureGate.tsx`)

- **Focus order**: title, then reason text.
- **Labels announced**: the "not ready" title reads the full templated sentence; the reason
  text reads verbatim.
- **Roles announced**: N/A (no interactive elements — this screen only ever shows or hides its
  `children`, which are audited separately once a real feature screen exists behind it).
- **State announced**: N/A.
- **Touch-target adequacy**: N/A.
- **Dynamic-type non-breakage**: title and reason text wrap without truncation.

### ProgressScreen (`src/onboarding/screens/ProgressScreen.tsx`)

- **Focus order**: title, then per-artifact rows in order (label → status → whichever single
  control applies: pause, resume, or retry+error).
- **Labels announced**: each row's label and status text read in full; pause/resume/retry
  buttons read their button text; on failure, the error message is announced before the retry
  button.
- **Roles announced**: pause/resume/retry all announce as "button".
- **State announced**: N/A (buttons don't carry a selected/checked state on this screen — status
  is conveyed via the adjacent status text, which is itself announced).
- **Touch-target adequacy**: pause/resume/retry buttons are comfortably tappable and don't
  collide with the status text above them.
- **Dynamic-type non-breakage**: status text (which can be long, e.g. "12.3 MB of 45.6 MB") wraps
  without truncating the button below it.

### ProvenanceScreen (`src/screens/ProvenanceScreen.tsx`)

- **Focus order**: title, then (ready state) latest-set / CR-version / legality-as-of rows in
  order, or (empty state) the single explanatory message.
- **Labels announced**: every row reads its full templated sentence, not just the raw value.
- **Roles announced**: N/A (no interactive elements).
- **State announced**: N/A.
- **Touch-target adequacy**: N/A.
- **Dynamic-type non-breakage**: all rows wrap without truncation; the empty-state message
  (italic, longer prose) wraps cleanly.

### SmokeScreen (`src/smokeScreen/SmokeScreen.tsx`)

- **Focus order**: title → summary → each module row (label, then status, then detail if
  present) in the fixed `MODULE_IDS` order → "Run checks again" button → device-run note.
- **Labels announced**: the "Run checks again" `<Button>` announces its title text; each module
  row's label, status word, and (when present) detail text are all announced.
- **Roles announced**: "Run checks again" announces as "button" (RN's `Button` sets this
  automatically).
- **State announced**: the button's disabled state (while checks are running) is announced as
  "dimmed"/"disabled" — confirm it is not silently skipped by the swipe order while disabled.
- **Touch-target adequacy**: the button is comfortably tappable; module rows are dense
  (`paddingVertical: 8`) but are not themselves interactive, so this only matters for the button.
- **Dynamic-type non-breakage**: module rows (label + status + detail, three stacked texts) wrap
  without overlapping each other or the hairline row divider.

### LanguageSwitcher (`src/i18n/LanguageSwitcher.tsx`)

- **Focus order**: title, then one row per option in `OPTIONS` order (`system`, then each
  `SUPPORTED_LOCALES` entry) — confirm a newly-added locale slots into this order with no other
  change needed.
- **Labels announced**: each option reads its localized label text.
- **Roles announced**: each option announces as "radio" (matching its single-select semantics).
- **State announced**: the currently-active option announces as "selected"; all others announce
  as not selected — confirm this updates immediately after tapping a different option (no stale
  announcement).
- **Touch-target adequacy**: option rows are comfortably tappable and don't collide with each
  other (currently unstyled/stacked — see the top-of-file "bare-minimum" note; this checklist
  entry is what will catch it if that changes badly, not a claim it's already been verified
  against a specific target size).
- **Dynamic-type non-breakage**: option labels wrap without truncation or overlapping the next
  row.

## Filing results

Record pass/fail plus any screen-reader-specific note (VoiceOver vs. TalkBack sometimes differ
in exactly what they announce for the same props) against the APP-036 TestFlight QA pass this
checklist is written for. A failure here does not block a merge (this checklist is not part of
`npm run gate`) but does block a release until resolved or explicitly accepted.
