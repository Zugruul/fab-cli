"""ArcFace additive angular margin loss (APP-028, SPEC-APP.md §8.7d). This
is a LOSS FUNCTION, not a pretrained model — no third-party model weights
or architecture are involved, so Invariant 9's license concern doesn't
apply here at all. Implements the additive angular margin softmax from
Deng et al. 2019 ("ArcFace: Additive Angular Margin Loss for Deep Face
Recognition"): for the TRUE class only, margin `m` is added to the angle
between the (L2-normalized) embedding and that class's (L2-normalized)
weight vector before taking the cosine back and scaling by `s` — making
the true-class logit strictly harder to satisfy than a plain margin-0
softmax, which is what pulls same-identity crops together and different-
identity crops apart in embedding space.

`ArcFaceHead` owns the per-class weight matrix (a plain nn.Parameter,
L2-normalized at every forward pass — never persisted un-normalized) and
is TRAINING-ONLY: the exported on-device model (embed_export.py) never
includes it, matching standard face-recognition-model deployment practice
(only the embedding trunk ships; the margin-softmax head that shaped its
embedding space during training is discarded).

BOUNDARY GUARD (review finding, PR #240 item 1): a naive `cos(theta +
margin)` is only monotonically DEcreasing in theta while `theta + margin
<= pi`. Past that point (deep-negative cosine, i.e. theta close to pi —
reachable with a small embedding_dim/few classes, where concentration of
measure is weak) it wraps around and comes back UP, making the true-class
logit EASIER to satisfy — exactly backwards from ArcFace's purpose.
`arcface_logits` therefore uses the standard InsightFace "easy margin"
guard: once `cosine <= cos(pi - margin)` (equivalently `theta + margin >=
pi`), it falls back to a linear approximation, `cosine - sin(pi -
margin) * margin`, which stays monotonically <= the plain cosine
everywhere (verified in test_arcface_loss.py's boundary-pinned case).
"""
import math

import torch
import torch.nn as nn
import torch.nn.functional as F

DEFAULT_MARGIN = 0.5
DEFAULT_SCALE = 64.0
_COSINE_EPS = 1e-7  # keeps acos() finite at the +-1 boundary


def arcface_logits(cosine: torch.Tensor, labels: torch.Tensor, margin: float, scale: float) -> torch.Tensor:
    """`cosine`: (N, C) cosine similarities between each embedding and
    every class weight vector (both already L2-normalized by the caller).
    `labels`: (N,) integer class indices. Returns (N, C) scaled logits
    with the additive angular margin applied ONLY at each row's true-class
    column — every other column is the plain scaled cosine, unchanged.

    Past the `cos(pi - margin)` threshold, uses the linear easy-margin
    fallback instead of `cos(theta + margin)` directly — see this module's
    doc comment for why the naive formula reverses beyond that boundary."""
    clamped = cosine.clamp(-1.0 + _COSINE_EPS, 1.0 - _COSINE_EPS)
    theta = torch.acos(clamped)
    margin_cosine = torch.cos(theta + margin)

    threshold = math.cos(math.pi - margin)
    easy_margin_fallback = cosine - math.sin(math.pi - margin) * margin
    target_cosine = torch.where(cosine > threshold, margin_cosine, easy_margin_fallback)

    one_hot = F.one_hot(labels, num_classes=cosine.shape[1]).to(cosine.dtype)
    logits = cosine * (1.0 - one_hot) + target_cosine * one_hot
    return logits * scale


class ArcFaceHead(nn.Module):
    def __init__(self, embedding_dim: int, num_classes: int, margin: float = DEFAULT_MARGIN, scale: float = DEFAULT_SCALE):
        super().__init__()
        if num_classes <= 0:
            raise ValueError(f"ArcFaceHead requires at least 1 class, got {num_classes}")
        self.weight = nn.Parameter(torch.randn(num_classes, embedding_dim) * 0.01)
        self.margin = margin
        self.scale = scale

    def forward(self, embeddings: torch.Tensor, labels: torch.Tensor) -> torch.Tensor:
        """`embeddings`: (N, D), ALREADY L2-normalized (ArcFaceEmbedder's
        own forward() normalizes by default — see embed_model.py). Returns
        (N, C) margin-adjusted scaled logits, ready for cross_entropy."""
        normalized_weight = F.normalize(self.weight, p=2, dim=1)
        cosine = embeddings @ normalized_weight.t()
        return arcface_logits(cosine, labels, self.margin, self.scale)


def arcface_loss(embeddings: torch.Tensor, head: ArcFaceHead, labels: torch.Tensor) -> torch.Tensor:
    logits = head(embeddings, labels)
    return F.cross_entropy(logits, labels)
