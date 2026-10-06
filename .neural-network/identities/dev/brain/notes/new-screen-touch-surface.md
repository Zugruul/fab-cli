---
tags: [react-native, a11y, i18n, screens]
paths: ["fab-app/**"]
strength: 1
source: "PR#248 APP-024 retro"
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

New fab-app screen touch surface is exactly: entries in a11y/__tests__/screenRegistry.tsx (one per meaningful UI state) + locale JSON keys (en + pt-BR) — the i18n/a11y/theme check logic itself never changes. Prefer RN's own <Button> for plain action buttons: free accessible name/role structurally (SmokeScreen precedent), zero a11y wiring.
