---
tags: [testing, regression, mutation]
paths: ["pipeline/**", "fab-app/**", "fab-cli/**"]
strength: 1
source: "PR#255 #253 retro"
confidence: direct
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

A regression-test FIX is not proven until the exact mutation is re-run against THAT fix — a revised assertion can be vacuous for a new reason. Two failure modes to check: (a) the compared signal passes through an unconditional downstream transform (translation/hash/serialize) that makes 'different' true for ALL inputs — compare the untransformed signal (printingIds, not translated corners); (b) the expected value is derived by re-invoking the same building blocks the code path calls — proves the primitive is input-sensitive without exercising whether the higher-level function WIRES the input through. Diff against independently-computed ground truth, through the real code path. PR#255: both modes hit in one task.

Related: [[test-knob-intersections]] [[no-guard-code-is-an-unstated-invariant]]
