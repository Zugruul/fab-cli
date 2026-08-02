---
tags: [react-native, jest, mocking]
paths: ["fab-app/**"]
strength: 1
source: ""
learned-from: task 219
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

react-native's index.js exports most things as LAZY getters (get X() { return require(...) }), including native-module-backed ones (DevMenu, Clipboard). `jest.mock('react-native', () => ({...jest.requireActual('react-native'), X: jest.fn()}))` breaks because spreading forces every getter to evaluate eagerly and native-backed ones throw under jest. Correct pattern for mocking a single named RN export: wrap jest.requireActual('react-native') in a Proxy that intercepts only the mocked property and Reflect.get's everything else. Also: useColorScheme is safely callable UN-mocked under this jest setup — only mock it when a test must FORCE a specific scheme, not to avoid a crash.
