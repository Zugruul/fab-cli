# Design — app/E3: App foundation & artifact versioning

Grounded in: SPEC-APP §9 (all), §13 invariants 3/5/9, §14. Written retroactively at the
first post-E3-scaffold task that needed it (#217 i18n); records the architecture E3 tasks
already shipped plus the i18n layer #217 adds (spec delta `docs/spec-deltas/217.md`, folds
into §9 on merge).

## Components

- `fab-app/App.tsx` — root composition: SafeAreaProvider + StatusBar + active screen.
  Single-screen for now (SmokeScreen); no navigation library yet.
- `fab-app/src/smokeScreen/` — device smoke screen exercising the four native pillars
  (llama.rn, op-sqlite+sqlite-vec, vision-camera, fast-tflite) per §9.1.
- `fab-app/src/onboarding/` — first-run experience components (§9.9): ConsentScreen
  (download consent + sizes), FeatureGate (model-free degradation), ProgressScreen
  (pause/resume/retry). Test-covered components, not yet wired into App navigation.
- `fab-app/src/screens/ProvenanceScreen.tsx` — knowledge-provenance surface (§9.4).
- `fab-app/src/artifacts/`, `src/lifecycle/`, `src/provenance/`, `src/retrieval/` —
  artifact manager (§9.2–9.5), inference lifecycle (§9.6), provenance derivation (§9.4),
  on-device retrieval engine (§9.7).
- `fab-app/src/i18n/` (#217) — app-language layer: framework init + `en`/`pt-BR` resource
  bundles + system-locale detection + persisted manual override. UI strings only; corpus /
  model answers stay English (v1).

## Data models

- Locale: `'en' | 'pt-BR'` — `en` is the source-of-truth bundle; pt-BR must have full key
  parity (machine-checked in the gate).
- Language preference: `system | en | pt-BR`, persisted on-device (no accounts — §13
  invariant 5; preference never leaves the device).

## Interfaces / contracts

- i18n access is exclusively via the framework's hook/API (e.g. `useTranslation()`/`t()`)
  — no raw user-facing string literals in JSX (gate-enforced).
- Locale resolution: explicit override if set, else system locale; `pt-*` → `pt-BR`,
  anything else → `en`.
- Gate contract (fab-app `npm run gate`, inherited by root `pnpm -r gate`): typecheck +
  lint (incl. no-hardcoded-JSX-literals rule) + tests + en/pt-BR key-parity check. All
  gate tests pass with the network disabled (§13 invariant 10).

## Key sequences

1. App start → read persisted language preference → resolve locale (override ?? system
   mapping) → init i18n before first render → screens render translated strings.
2. User changes language in the settings surface → preference persisted → i18n language
   switched at runtime → UI re-renders in the new language without reinstall.

## Decisions

- i18n framework: dev agent picks react-i18next or Lingui and justifies in the PR;
  constraint — must work offline, no runtime network fetch of bundles (offline-first,
  §13 invariant 5), bundles compiled into the JS bundle.
- Manual override lives in a minimal settings surface (none exists yet) — smallest honest
  UI, no navigation library introduction for this task alone.
- Translation completeness is enforced structurally (key parity + no-literal lint), not by
  human review — except consent-screen legal text, which has a named human release gate.

## Out of scope for this epic

- Q&A experience UI (E4 §10), card scanning (E5 §11), catalog/QR (E6 §12).
- Translating corpus content, retrieval chunks, or model answers (explicitly out of v1
  i18n scope per #217).
