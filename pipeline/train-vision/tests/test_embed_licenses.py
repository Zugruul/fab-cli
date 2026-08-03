"""License record for the recognition embedder (APP-028, SPEC-APP.md §5,
§13 Invariant 9). Reuses licenses.py's generic validate_licenses gate
(already fully tested by test_licenses.py) -- this file only checks the
embedder's OWN license table content, not the validator's generic rules.
"""
from train_vision.embed_licenses import EMBEDDER_LICENSES
from train_vision.licenses import validate_licenses


def test_embedder_licenses_are_all_allowlisted_and_non_empty():
    validate_licenses(EMBEDDER_LICENSES)  # must not raise
    for name, license_id in EMBEDDER_LICENSES.items():
        assert isinstance(license_id, str) and license_id.strip() != "", name


def test_embedder_licenses_names_the_expected_components():
    # From-scratch (no pretrained weights, same Invariant-9 reasoning as
    # the detector), plus the int8 export chain: litert-torch's plain
    # float export + ai_edge_quantizer's decoupled post-training
    # quantization (see embed_export.py's doc comment for why this path
    # was chosen over a PT2E-in-litert_torch.convert() flow).
    assert EMBEDDER_LICENSES["trainingCode"] == "MIT"
    assert EMBEDDER_LICENSES["torch"] == "BSD-3-Clause"
    assert EMBEDDER_LICENSES["litertTorch"] == "Apache-2.0"
    assert EMBEDDER_LICENSES["aiEdgeLitert"] == "Apache-2.0"
    assert EMBEDDER_LICENSES["litertConverter"] == "Apache-2.0"
    assert EMBEDDER_LICENSES["aiEdgeQuantizer"] == "Apache-2.0"
