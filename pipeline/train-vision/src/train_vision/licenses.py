"""License identifiers for the OBB detector run manifest (APP-027,
SPEC-APP.md §5, §13 Invariant 9: "Apache/MIT-licensed OBB detector...
Ultralytics YOLO11 is excluded: AGPL-3.0... violates Invariant 9 for a
shipped artifact"). Mirrors pipeline/src/export/licenses.ts's role (pure
constants + a validator), but goes one step further per this issue's AC
("manifest builder refuses empty/unknown license fields"): validate_licenses
is a hard gate, not just documentation, so a future edit that accidentally
introduces a copyleft or unrecorded dependency fails loudly instead of
shipping silently.
"""
import re
from typing import Dict

# The exact, verified dependency-chain license record for this package's
# architecture (custom, from-scratch CenterNet-style OBB head on a tiny
# hand-rolled Conv-BN-ReLU backbone — see model.py's doc comment for the
# full grounding, including why "from scratch" sidesteps the
# pretrained-ImageNet-weight license ambiguity that torchvision's own
# forum discussions leave unresolved for its hosted weights):
#   - trainingCode: this package itself, MIT (matches pipeline/package.json
#     — SPEC-APP.md §5/§13-I9 "training code license included").
#   - torch: BSD-3-Clause (verified against pytorch/pytorch's own LICENSE
#     file). This is the ONLY third-party model-definition dependency —
#     model.py never imports torchvision at all.
#   - torchvision: BSD-3-Clause (verified against pytorch/vision's own
#     LICENSE file), recorded here for completeness only — SPEC-APP.md
#     §13's own candidate list for this task cites it, but this package's
#     actual code has zero torchvision dependency (no import, no
#     pretrained weights, nothing). Kept in the table so a reader
#     comparing against the spec's candidate list isn't left wondering
#     whether it was silently forgotten.
#   - litertTorch / aiEdgeLitert / litertConverter: Apache-2.0 (Google AI
#     Edge / LiteRT — the ai-edge-torch -> litert-torch rename's successor
#     package; verified via `pip show` + litert-torch's own setup.py on
#     PyPI, both Apache-2.0). This is the torch -> tflite export chain.
ARCHITECTURE_LICENSES: Dict[str, str] = {
    "trainingCode": "MIT",
    "torch": "BSD-3-Clause",
    "torchvision": "BSD-3-Clause",
    "litertTorch": "Apache-2.0",
    "aiEdgeLitert": "Apache-2.0",
    "litertConverter": "Apache-2.0",
}

# SPEC-APP.md §13 Invariant 9: Apache-2.0/MIT preferred; AGPL/Ultralytics
# excluded outright. BSD-2/3-Clause are the same permissive family Invariant
# 9's own examples (torch/torchvision) require, so they're allowlisted too.
ALLOWED_LICENSES = {"MIT", "Apache-2.0", "BSD-3-Clause", "BSD-2-Clause"}

# Matched case-insensitively against ANY substring of a submitted license
# string — belt-and-suspenders against a value like "Ultralytics-YOLO-AGPL"
# that isn't a bare allowlist miss but actively names the excluded family.
_COPYLEFT_PATTERN = re.compile(r"gpl", re.IGNORECASE)


def validate_licenses(licenses: Dict[str, object]) -> None:
    """Raises ValueError on the first violation found (order: empty/missing,
    then copyleft, then not-allowlisted) — this is a hard gate the manifest
    builder calls before ever writing a run manifest, not an advisory lint.
    """
    for name, value in licenses.items():
        if value is None or not isinstance(value, str) or value.strip() == "":
            raise ValueError(f'license field "{name}" is empty/missing — every recorded license must be a real, non-empty string')
        if _COPYLEFT_PATTERN.search(value):
            raise ValueError(
                f'license field "{name}" = "{value}" names a copyleft (GPL family) license — '
                "SPEC-APP.md §13 Invariant 9 excludes AGPL/GPL for any shipped artifact."
            )
        if value not in ALLOWED_LICENSES:
            raise ValueError(
                f'license field "{name}" = "{value}" is not on the allowlist ({sorted(ALLOWED_LICENSES)}) — '
                "verify the real license and add it to ALLOWED_LICENSES deliberately, don't guess."
            )
