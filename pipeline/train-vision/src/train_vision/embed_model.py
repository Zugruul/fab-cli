"""ArcFace recognition embedder architecture (APP-028, SPEC-APP.md §8.7d,
§5, §13 Invariant 9). Same from-scratch, zero-pretrained-weights, zero-
third-party-model-definition-dependency stance as train_vision/model.py's
OBB detector (see that module's doc comment for the full Invariant-9
grounding) — this is a SEPARATE, independent backbone definition (not a
refactor of ObbCenterNet into a shared base class), so this task's
changes never touch the already-shipped, reviewed APP-027 detector code.
A small amount of structural duplication (both are plain Conv-BN-ReLU
stacks) is the accepted, deliberate trade-off for that isolation.

Architecture: a plain Conv-GroupNorm-ReLU downsampling stack (stride-2 x
`num_downsamples`) -> global average pool -> a single Linear projection
to `embedding_dim`. GroupNorm (not BatchNorm2d, unlike the detector's
ObbCenterNet) is a deliberate choice: this package's own smoke/synthetic-
val training loops routinely hit a final batch of size 1 (a tiny fixture
dataset with a small batchSize), which BatchNorm2d cannot process in
training mode at all (it needs >1 sample to estimate a batch statistic) —
GroupNorm normalizes per-sample and has no such batch-size floor, at the
cost of no third-party dependency either way (both are plain `torch.nn`).
`forward(x, normalize=True)` L2-normalizes the output
by default — required for ArcFaceHead's cosine-similarity math to be
correct (see arcface_loss.py). `normalize=False` is used ONLY by
embed_export.py via `EmbedderForExport`: the shipped on-device model
outputs the PRE-normalization raw feature vector, because L2-normalize is
a division/sqrt op this repo's local int8 post-training-quantization
toolchain cannot cleanly carry through the shipped graph — see
embed_export.py's doc comment for the full reasoning. Application code
dequantizes then L2-normalizes before cosine-similarity KNN.
"""
import torch
import torch.nn as nn
import torch.nn.functional as F

DEFAULT_EMBEDDING_DIM = 256


def _num_groups(channels: int, max_groups: int = 8) -> int:
    """Largest group count <= max_groups that evenly divides `channels` —
    GroupNorm requires channels % num_groups == 0; falls back to 1 (equivalent
    to LayerNorm-over-channels) if nothing else divides evenly."""
    for g in (max_groups, 4, 2, 1):
        if g <= channels and channels % g == 0:
            return g
    return 1


class ArcFaceEmbedder(nn.Module):
    def __init__(self, embedding_dim: int = DEFAULT_EMBEDDING_DIM, in_channels: int = 3, base_channels: int = 16, num_downsamples: int = 4):
        super().__init__()
        if num_downsamples <= 0:
            raise ValueError(f"num_downsamples must be positive, got {num_downsamples}")

        layers = []
        c_in = in_channels
        c_out = base_channels
        for _ in range(num_downsamples):
            layers += [nn.Conv2d(c_in, c_out, kernel_size=3, stride=2, padding=1), nn.GroupNorm(_num_groups(c_out), c_out), nn.ReLU(inplace=True)]
            c_in, c_out = c_out, c_out * 2
        self.backbone = nn.Sequential(*layers)
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.fc = nn.Linear(c_in, embedding_dim)
        self.embedding_dim = embedding_dim

    def forward(self, x: torch.Tensor, normalize: bool = True) -> torch.Tensor:
        feat = self.backbone(x)
        pooled = self.pool(feat).flatten(1)
        embedding = self.fc(pooled)
        if normalize:
            embedding = F.normalize(embedding, p=2, dim=1, eps=1e-12)
        return embedding


class EmbedderForExport(nn.Module):
    """Thin wrapper fixing normalize=False at trace time — torch.export
    needs a module whose forward takes only tensor args (a bare Python
    bool default is fine since it's resolved at trace time, not runtime;
    see embed_export.py's usage)."""

    def __init__(self, embedder: ArcFaceEmbedder):
        super().__init__()
        self.embedder = embedder

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.embedder(x, normalize=False)
