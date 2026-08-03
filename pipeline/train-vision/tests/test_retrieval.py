"""Top-1/top-K retrieval accuracy over a printing-id-keyed embedding
gallery (APP-028, SPEC-APP.md §8.7d AC: "top-1 >=95% ... (G3 gate)"). Pure
Python + math, no torch/numpy -- dataset-agnostic by construction, so the
SAME function later scores real-photo-benchmark crops (APP-025) with zero
changes. Every accuracy number below is hand-computed against a tiny,
fully-known gallery (dev brain lesson: assert values, not just shape).
"""
import math

import pytest

from train_vision.retrieval import cosine_similarity, rank_gallery, topk_accuracy


def test_cosine_similarity_hand_computed_values():
    assert cosine_similarity([1.0, 0.0], [1.0, 0.0]) == pytest.approx(1.0)
    assert cosine_similarity([1.0, 0.0], [-1.0, 0.0]) == pytest.approx(-1.0)
    assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)
    # 3D, non-trivial: dot=1*4+2*5+3*6=32, |a|=sqrt(14), |b|=sqrt(77)
    a, b = [1.0, 2.0, 3.0], [4.0, 5.0, 6.0]
    expected = 32.0 / (math.sqrt(14.0) * math.sqrt(77.0))
    assert cosine_similarity(a, b) == pytest.approx(expected, rel=1e-9)


def test_cosine_similarity_zero_vector_is_defined_as_zero_not_a_crash():
    assert cosine_similarity([0.0, 0.0], [1.0, 0.0]) == pytest.approx(0.0)


def test_cosine_similarity_rejects_dimension_mismatch():
    with pytest.raises(ValueError, match="dimension mismatch"):
        cosine_similarity([1.0, 0.0], [1.0, 0.0, 0.0])


GALLERY = [
    {"printing_id": "p1", "embedding": [1.0, 0.0]},
    {"printing_id": "p2", "embedding": [0.0, 1.0]},
    {"printing_id": "p3", "embedding": [-1.0, 0.0]},
]


def test_rank_gallery_orders_by_similarity_best_first_hand_verified():
    # Query is close to p1 (angle 0), then p2 (90deg, cos=0), then p3 (180deg, cos=-1).
    ranked = rank_gallery([0.9, 0.1], GALLERY)
    assert ranked == ["p1", "p2", "p3"]


def test_topk_accuracy_hand_computed_over_a_tiny_known_gallery():
    # Queries: q1 near p1 (correct top-1), q2 near p3 (correct top-1),
    # q3 near p2 but its TRUE id is p3 (a deliberate top-1 miss, present
    # within top-2 since p3 ranks second for a query near p2's opposite... )
    queries = [
        {"printing_id": "p1", "embedding": [1.0, 0.05]},
        {"printing_id": "p3", "embedding": [-1.0, 0.05]},
        {"printing_id": "p3", "embedding": [0.05, 1.0]},  # near p2, true id is p3
    ]
    result = topk_accuracy(GALLERY, queries, k_values=(1, 2))
    assert result["queryCount"] == 3
    assert result["top1"] == pytest.approx(2 / 3)
    # For query 3 (near p2=[0,1]): similarity to p2 is highest, then p1
    # (cos~0.05), then p3 (cos~-0.05) -- p3 (the true id) ranks LAST, so it
    # is NOT within top-2 either. top2 accuracy stays 2/3.
    assert result["top2"] == pytest.approx(2 / 3)


def test_topk_accuracy_true_id_absent_from_gallery_counts_as_a_miss_not_a_crash():
    queries = [{"printing_id": "unknown-id", "embedding": [1.0, 0.0]}]
    result = topk_accuracy(GALLERY, queries, k_values=(1, 3))
    assert result["top1"] == pytest.approx(0.0)
    assert result["top3"] == pytest.approx(0.0)  # absent from ALL of the gallery, even at k=3


def test_topk_accuracy_rejects_empty_queries():
    with pytest.raises(ValueError, match="queries must not be empty"):
        topk_accuracy(GALLERY, [], k_values=(1,))


def test_topk_accuracy_rejects_empty_gallery():
    with pytest.raises(ValueError, match="gallery must not be empty"):
        topk_accuracy([], [{"printing_id": "p1", "embedding": [1.0, 0.0]}], k_values=(1,))
