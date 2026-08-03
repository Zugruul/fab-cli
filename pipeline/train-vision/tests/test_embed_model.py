"""ArcFaceEmbedder architecture (APP-028): output-shape/normalization
contract. No GPU, no torchvision, no pretrained weights -- a separate,
independent backbone from train_vision/model.py's OBB detector (see
embed_model.py's doc comment for why this is a deliberate, isolated
duplication rather than a shared-base-class refactor of the already-
shipped detector).
"""
import torch

from train_vision.embed_model import ArcFaceEmbedder, EmbedderForExport


def test_forward_output_shape_matches_configured_embedding_dim():
    model = ArcFaceEmbedder(embedding_dim=32, base_channels=4, num_downsamples=2)
    x = torch.randn(3, 3, 16, 16)
    out = model(x)
    assert out.shape == (3, 32)


def test_forward_default_normalizes_to_unit_l2_norm():
    model = ArcFaceEmbedder(embedding_dim=16, base_channels=4, num_downsamples=2)
    x = torch.randn(4, 3, 16, 16)
    out = model(x)
    norms = out.norm(p=2, dim=1)
    assert torch.allclose(norms, torch.ones(4), atol=1e-5)


def test_forward_normalize_false_returns_exactly_the_pre_normalization_features():
    model = ArcFaceEmbedder(embedding_dim=16, base_channels=4, num_downsamples=2)
    x = torch.randn(4, 3, 16, 16)
    raw = model(x, normalize=False)
    normalized = model(x, normalize=True)
    expected = torch.nn.functional.normalize(raw, p=2, dim=1)
    assert torch.allclose(normalized, expected, atol=1e-5)
    # And the raw output is not already unit-norm in general (otherwise
    # this test would trivially pass without actually exercising the
    # normalize=False branch).
    assert not torch.allclose(raw.norm(p=2, dim=1), torch.ones(4), atol=1e-3)


def test_rejects_non_positive_num_downsamples():
    import pytest

    with pytest.raises(ValueError, match="num_downsamples"):
        ArcFaceEmbedder(num_downsamples=0)


def test_embedder_for_export_matches_normalize_false_exactly():
    model = ArcFaceEmbedder(embedding_dim=16, base_channels=4, num_downsamples=2)
    export_module = EmbedderForExport(model)
    x = torch.randn(2, 3, 16, 16)
    assert torch.equal(export_module(x), model(x, normalize=False))
