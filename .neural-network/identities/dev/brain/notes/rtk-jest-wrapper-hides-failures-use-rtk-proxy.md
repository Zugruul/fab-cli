---
tags: [rtk, jest, harness, debugging]
paths: ["**"]
strength: 1
source: ""
learned-from: task 218
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

The rtk harness's jest wrapper collapses `--verbose` output to a one-line PASS/FAIL summary, hiding WHICH suite/assertion failed — useless when verifying that red tests fail for the right reason. Use `rtk proxy npx jest <path>` (rtk's raw-command escape hatch) to get real jest output when diagnosing failures or proving red-commit failures. Also: react-native's own source is present at fab-app/node_modules/react-native/Libraries/** — read Button.js/Switch.js etc. there directly to answer "does RN set this prop internally" questions; don't assume it's absent after one wrong-path grep (looser-pattern lesson applies).
