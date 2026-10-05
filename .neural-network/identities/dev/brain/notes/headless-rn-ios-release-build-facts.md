---
tags: [ios, xcodebuild, react-native, release]
paths: ["fab-app/**"]
strength: 2
source: ""
confidence: direct
learned-from: task 144 live run + retro
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

Facts from the first real headless RN-iOS archive on this repo (#144): (a) macOS ships bash 3.2 — empty array under `set -u` throws; use scalars for optional args. (b) Automatic signing needs an EXPLICIT DEVELOPMENT_TEAM even single-team; resolve programmatically from the bundle-id registration's `seedId` via the ASC API (ours: S9ZASLM4D8). (c) Metro can't resolve hoisted deps unless metro.config.js watchFolders includes the monorepo root (node-linker=hoisted) — archive-time bundling fails on @babel/runtime otherwise. (d) A fresh Xcode may LIST the iOS SDK yet lack the device platform — run `xcodebuild -downloadPlatform iOS` (~8.5GB) before generic/platform=iOS works. (e) Any log-processing stage between xcodebuild and the log file must STREAM, never buffer-to-EOF — a buffering pipe makes a multi-minute build look like a hang. (f) In this harness, `nohup cmd &` inside a Bash call does not survive the call — use the tool's run_in_background parameter. (g) Archive succeeds headlessly with API-key auth; the cloud-signing EXPORT step is where permissions bite — see asc-cloud-signing-wall-facts.
