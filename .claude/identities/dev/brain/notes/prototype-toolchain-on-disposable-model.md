---
tags: [toolchain, export, quantization]
paths: ["pipeline/**"]
strength: 1
source: "PR#240 APP-028 retro"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

Before writing any real architecture or tests for a new export/quantization/conversion path, prototype the ENTIRE toolchain (export -> quantize -> load) on a disposable one-layer model. PR#240: this isolated a real litert-torch/torchao version-skew bug in minutes (reproduced on bare nn.Linear) instead of mid-implementation with a real model muddying the diagnosis.

Related: [[read-producers-real-bytes-before-fixtures]]
