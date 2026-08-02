---
tags: [react-native, jest, fab-app, testing]
paths: ["fab-app/**"]
strength: 1
source: ""
learned-from: task 217
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

fab-app RN-jest facts worth reusing: (1) SafeAreaProvider renders NULL children under jest (no native initial-insets event fires headlessly) — App-level tests can only be mount-doesn't-throw smokes (use async act() to avoid effect act-warnings); assert real rendered content in component-level tests below the provider instead. (2) op-sqlite's `Storage` helper class is unusable under the shared jest mock (its constructor calls `executeSync`, which the mock doesn't implement — and the mock is shared with the sqlite-vec smoke check, don't extend it casually); persistence code should define its own tiny injectable interface (mirroring the codebase's NetworkStateSource/FileSystem patterns) backed by plain `open()` + a small table, which mocks trivially. (3) Per-locale screen tests: `describe.each(SUPPORTED_LOCALES)` asserting against `LOCALE_BUNDLES[locale]`'s real (interpolated) strings — never hardcoded translations — makes new locales auto-covered.
