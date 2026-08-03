"""License table for the recognition embedder (APP-028, SPEC-APP.md §5,
§13 Invariant 9) — same from-scratch/no-pretrained-weights stance as
train_vision/licenses.py's detector table (see that module's doc comment
for the full Invariant-9 reasoning). Reuses licenses.py's generic
validate_licenses gate directly rather than duplicating the validation
logic — only the license DATA differs between the two jobs, never the
validation rule.

One real difference from the detector's dependency chain: this package's
int8 export goes through `ai_edge_quantizer` (Google AI Edge's post-
training-quantization library, Apache-2.0) rather than a PT2E-based
quantize-in-litert_torch.convert() flow — see embed_export.py's doc
comment for why: a version-skew bug in this repo's currently pinned
litert-torch/torchao/torch combination breaks the PT2E static-quant path
at the MLIR-converter-pass stage for ANY model (reproduced independently
on a bare nn.Linear), so it is a real toolchain incompatibility, not a
bug in this package's model code. The ai_edge_quantizer path was verified
end-to-end in this repo's actual venv (float export -> calibrate ->
quantize -> int8 tflite loads with the correct int8 in/out dtype) before
being adopted here.
"""
from typing import Dict

EMBEDDER_LICENSES: Dict[str, str] = {
    "trainingCode": "MIT",
    "torch": "BSD-3-Clause",
    "litertTorch": "Apache-2.0",
    "aiEdgeLitert": "Apache-2.0",
    "litertConverter": "Apache-2.0",
    "aiEdgeQuantizer": "Apache-2.0",
}
