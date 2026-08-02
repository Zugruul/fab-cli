---
tags: [fab-app, eslint, conventions]
paths: ["fab-app/**"]
strength: 1
source: ""
learned-from: tasks 217-219
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

fab-app's gate lint rules all use the identical override scoping — files: ['App.tsx', 'src/**/*.tsx'], excludedFiles: ['**/__tests__/**', '**/*.test.tsx'] — now three times (no-hardcoded-literals/i18n, react-native-a11y, no-color-literals). For E4+ reviews: check a new gate lint rule against this exact pattern rather than re-deriving scoping; deviation is a finding unless justified.
