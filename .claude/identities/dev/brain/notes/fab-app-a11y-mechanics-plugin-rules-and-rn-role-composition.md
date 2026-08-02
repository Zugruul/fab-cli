---
tags: [a11y, fab-app, eslint, react-native]
paths: ["fab-app/**"]
strength: 1
source: ""
learned-from: task 218
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

fab-app a11y mechanics worth reusing: (a) in eslint-plugin-react-native-a11y the rule that requires a11y props to EXIST is `has-valid-accessibility-descriptors`; `has-accessibility-props` sounds like that rule but only checks deprecated accessibilityTraits/ComponentType conflicts — a naming trap. (b) RN's <Button> composes into a Touchable with accessibilityRole="button" set internally, <Switch> defaults role="switch" — so a generic walker needs NO special cases for them; role-checking is table-driven per primitive (name-resolution strategy + whether the role is structurally guaranteed vs author-supplied), and future primitives add a row. (c) Default the plugin to the `basic` config (WCAG core, platform-agnostic); adopt ios/android/all only when a screen actually grows the relevant surface (first <Image> → iOS invert-colors rule). (d) The SCREENS registration-table pattern (mirror of SUPPORTED_LOCALES) is the reusable shape for ANY "one generic gate check across every screen" need.
