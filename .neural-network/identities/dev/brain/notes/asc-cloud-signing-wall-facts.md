---
tags: [ios, signing, asc-api, credentials]
paths: ["fab-app/**"]
strength: 1
source: ""
confidence: direct
learned-from: task 144 live run
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

Xcode's cloud-managed signing (the mechanism behind `-allowProvisioningUpdates`/Automatic that creates ephemeral signing identities without a local keychain) is a MATERIALLY DIFFERENT capability from basic ASC API cert/profile CRUD — an App Store Connect API key can create real distribution certificates via POST /v1/certificates (verified, 201) and read /v1/profiles, and still hard-fail cloud signing with "Cloud signing permission error". RULED OUT on #144, don't re-try: DEVELOPMENT_TEAM (resolved separately, worked), zero-provisioning-permission (disproven by the CSR test), transience (identical failure across 2 runs × ~6 internal retries). The three exits, all human: elevate the key App Manager → Admin (best guess), one-time Xcode GUI sign-in bootstrap, or explicitly-authorized local keychain signing (classifier-blocked for agents, correctly). Resume state: branch fab/144-testflight (pushed), diagnostic cert 24R39SH2X7 live in ASC (revoke if unused; its private key at /tmp/tf-debug/csr/dist.key).
