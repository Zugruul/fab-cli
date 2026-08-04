"""ArcFace additive angular margin loss (APP-028, SPEC-APP.md §8.7d).
Hand-pinned values for the margin/scale math (not just shape checks),
the degenerate single-class case, and a gradient-sanity overfit test
proving the whole differentiable path (embed -> normalize -> cosine ->
angular margin -> scale -> cross-entropy -> backward) actually learns.
"""
import math

import pytest
import torch

from train_vision.arcface_loss import ArcFaceHead, arcface_logits, arcface_loss
from train_vision.embed_model import ArcFaceEmbedder


def test_arcface_logits_applies_margin_only_to_the_true_class_hand_computed():
    cosine = torch.tensor([[0.8, 0.2]])
    labels = torch.tensor([0])
    margin, scale = 0.5, 2.0

    logits = arcface_logits(cosine, labels, margin, scale)

    expected_true_class = math.cos(math.acos(0.8) + margin) * scale
    expected_other_class = 0.2 * scale  # untouched by the margin
    assert logits[0, 0].item() == pytest.approx(expected_true_class, rel=1e-5)
    assert logits[0, 1].item() == pytest.approx(expected_other_class, rel=1e-6)


def test_arcface_logits_zero_margin_reduces_to_plain_scaled_cosine():
    cosine = torch.tensor([[0.8, -0.3, 0.1]])
    labels = torch.tensor([1])
    logits = arcface_logits(cosine, labels, margin=0.0, scale=10.0)
    assert torch.allclose(logits, cosine * 10.0, atol=1e-5)


def test_arcface_logits_larger_margin_strictly_lowers_the_true_class_logit_in_the_typical_range():
    # For cosine in (0, 1) and small margins, cos(theta+m) < cos(theta) --
    # the margin makes the true class harder to satisfy, which is the
    # entire point of ArcFace (it's what pulls same-identity embeddings
    # together during training).
    cosine = torch.tensor([[0.9, 0.0]])
    labels = torch.tensor([0])
    small = arcface_logits(cosine, labels, margin=0.1, scale=1.0)
    large = arcface_logits(cosine, labels, margin=0.6, scale=1.0)
    assert large[0, 0].item() < small[0, 0].item()


def test_arcface_logits_near_pi_boundary_stays_monotonically_harder_not_easier():
    # Deep-negative cosine (theta close to pi): a naive cos(theta+m) is
    # only monotonically DEcreasing while theta+m <= pi -- past that, it
    # wraps and comes back UP, making the true-class logit EASIER, exactly
    # backwards from ArcFace's purpose (review finding on PR #240: verified
    # numerically that the un-guarded formula raises cosine=-0.99 up to
    # ~-0.9364, i.e. makes the correct class MORE satisfiable, not less).
    # The standard InsightFace guard swaps in a linear "easy margin"
    # fallback (cosine - sin(pi-m)*m) once cosine <= cos(pi-m), which stays
    # monotonically <= the plain cosine everywhere.
    cosine = torch.tensor([[-0.99, 0.5]])
    labels = torch.tensor([0])
    margin = 0.5

    logits = arcface_logits(cosine, labels, margin, scale=1.0)

    mm = math.sin(math.pi - margin) * margin
    expected_true_class = -0.99 - mm  # the easy-margin linear fallback, NOT cos(theta+margin)
    assert logits[0, 0].item() == pytest.approx(expected_true_class, rel=1e-5)
    # The whole point of the guard: the margined logit must never end up
    # HIGHER than the plain cosine near this boundary -- that would make
    # the true class easier, not harder.
    assert logits[0, 0].item() <= cosine[0, 0].item()


def test_arcface_head_forward_produces_bounded_cosine_regardless_of_raw_weight_scale():
    # Seeded: the unseeded version flaked (#251) whenever a random draw put a
    # TARGET-class cosine below cos(pi - margin), where the easy-margin guard's
    # fallback (cosine - sin(pi - m) * m) legitimately extends the target logit
    # below -scale by scale * mm -- the old "<= scale" bound was stale after
    # the guard fix, not a real violation.
    torch.manual_seed(4242)
    head = ArcFaceHead(embedding_dim=4, num_classes=3)
    with torch.no_grad():
        head.weight.copy_(torch.randn(3, 4) * 1000.0)  # deliberately huge raw magnitude
    embeddings = torch.nn.functional.normalize(torch.randn(2, 4), dim=1)
    logits = head(embeddings, torch.tensor([0, 1]))
    # Non-target logits: scale * cosine, |.| <= scale. Target logits: either
    # scale * cos(theta + m) (|.| <= scale) or, past the guard threshold, the
    # fallback scale * (cosine - mm) which reaches -scale * (1 + mm). The
    # correct bound is therefore scale * (1 + mm), regardless of raw weight
    # magnitude (the head L2-normalizes its own weight).
    mm = math.sin(math.pi - head.margin) * head.margin
    assert torch.all(logits.abs() <= head.scale * (1.0 + mm) + 1e-4)


def test_arcface_head_fallback_branch_bound_at_extreme_negative_cosine():
    # Deterministic construction of the exact flake scenario: a target-class
    # cosine of ~-1 forces the easy-margin fallback, whose logit magnitude
    # must stay within scale * (1 + mm) but CAN exceed the naive scale bound.
    head = ArcFaceHead(embedding_dim=4, num_classes=2)
    with torch.no_grad():
        head.weight.copy_(torch.tensor([[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0]]))
    # Embedding exactly opposite class 0's weight vector -> cosine = -1.
    embeddings = torch.tensor([[-1.0, 0.0, 0.0, 0.0]])
    logits = head(embeddings, torch.tensor([0]))
    mm = math.sin(math.pi - head.margin) * head.margin
    target = logits[0, 0].item()
    assert target < -head.scale + 1e-4  # exceeds the naive bound...
    assert abs(target) <= head.scale * (1.0 + mm) + 1e-4  # ...within the true one


def test_arcface_head_rejects_zero_or_negative_class_count():
    with pytest.raises(ValueError, match="at least 1 class"):
        ArcFaceHead(embedding_dim=4, num_classes=0)


def test_arcface_loss_degenerate_single_class_is_always_exactly_zero():
    # With exactly one class, softmax over a single logit is always 1.0
    # regardless of its value -- so cross-entropy is always exactly 0,
    # independent of margin/scale/embedding content. This is a real,
    # documented degenerate case (nothing to separate from with only one
    # class to classify), not a special-cased shortcut in the loss code.
    head = ArcFaceHead(embedding_dim=8, num_classes=1, margin=0.5, scale=64.0)
    embeddings = torch.nn.functional.normalize(torch.randn(5, 8), dim=1)
    labels = torch.zeros(5, dtype=torch.long)
    loss = arcface_loss(embeddings, head, labels)
    assert loss.item() == pytest.approx(0.0, abs=1e-6)


def test_arcface_loss_gradient_sanity_the_whole_differentiable_path_overfits():
    torch.manual_seed(0)
    embedder = ArcFaceEmbedder(embedding_dim=8, base_channels=4, num_downsamples=2)
    head = ArcFaceHead(embedding_dim=8, num_classes=3, margin=0.3, scale=16.0)
    optimizer = torch.optim.Adam(list(embedder.parameters()) + list(head.parameters()), lr=1e-2)

    x = torch.randn(6, 3, 16, 16)
    labels = torch.tensor([0, 1, 2, 0, 1, 2])

    def current_loss():
        embeddings = embedder(x)
        return arcface_loss(embeddings, head, labels)

    initial = current_loss().item()
    for _ in range(80):
        optimizer.zero_grad()
        loss = current_loss()
        loss.backward()
        optimizer.step()
    final = current_loss().item()

    assert final < initial * 0.5, f"expected substantial overfit improvement, got initial={initial} final={final}"
