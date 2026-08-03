"""License-record enforcement (APP-027, SPEC-APP.md §5, §13 Invariant 9).
Invariant 9 (Apache-2.0/MIT only for a shipped artifact; AGPL/Ultralytics
excluded) is made mechanical here: the manifest builder must refuse to
record an empty or unrecognized license string for any component, and must
outright reject any AGPL/GPL-family identifier even if a caller tries to
supply one — a wrong license recorded here would poison the release
(per the issue brief), so this is a hard validation gate, not a lint.
"""
import pytest

from train_vision.licenses import ARCHITECTURE_LICENSES, validate_licenses


def test_architecture_licenses_are_all_allowlisted_and_non_empty():
    # The actual dependency-chain license record this package ships,
    # sanity-checked against its own validator.
    validate_licenses(ARCHITECTURE_LICENSES)
    for name, license_id in ARCHITECTURE_LICENSES.items():
        assert isinstance(license_id, str) and license_id.strip() != "", name


def test_architecture_licenses_names_the_expected_components():
    # torch/torchvision (BSD-3-Clause), no pretrained weights (from
    # scratch, sidesteps the pretrained-weight license ambiguity entirely),
    # litert-torch export chain (Apache-2.0, Google AI Edge), and this
    # package's own training code (MIT, matching pipeline/package.json).
    assert ARCHITECTURE_LICENSES["trainingCode"] == "MIT"
    assert ARCHITECTURE_LICENSES["torch"] == "BSD-3-Clause"
    assert ARCHITECTURE_LICENSES["torchvision"] == "BSD-3-Clause"
    assert ARCHITECTURE_LICENSES["litertTorch"] == "Apache-2.0"
    assert ARCHITECTURE_LICENSES["aiEdgeLitert"] == "Apache-2.0"
    assert ARCHITECTURE_LICENSES["litertConverter"] == "Apache-2.0"


def test_validate_licenses_rejects_empty_string():
    with pytest.raises(ValueError, match="empty"):
        validate_licenses({"foo": ""})


def test_validate_licenses_rejects_whitespace_only_string():
    with pytest.raises(ValueError, match="empty"):
        validate_licenses({"foo": "   "})


def test_validate_licenses_rejects_missing_key_entirely():
    with pytest.raises(ValueError, match="empty"):
        validate_licenses({"foo": None})


@pytest.mark.parametrize(
    "forbidden",
    ["AGPL-3.0", "agpl-3.0-only", "GPL-3.0", "gpl-2.0-or-later", "LGPL-3.0", "Ultralytics-YOLO-AGPL", "Proprietary", "Unknown"],
)
def test_validate_licenses_rejects_forbidden_or_unknown_identifiers(forbidden):
    with pytest.raises(ValueError, match="not on the allowlist|copyleft"):
        validate_licenses({"foo": forbidden})


@pytest.mark.parametrize("allowed", ["MIT", "Apache-2.0", "BSD-3-Clause", "BSD-2-Clause"])
def test_validate_licenses_accepts_the_allowlisted_identifiers(allowed):
    validate_licenses({"foo": allowed})  # must not raise
