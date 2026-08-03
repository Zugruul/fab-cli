"""Top-1/top-K retrieval accuracy over a printing-id-keyed embedding
gallery (APP-028, SPEC-APP.md §8.7d AC: "top-1 >=95% ... (G3 gate)"). Pure
Python + math (no torch/numpy dependency) so it is usable identically
whether the embeddings came from a synthetic-composite crop (this
package's own synthetic-val machinery) or, later, a real-photo benchmark
crop (APP-025) — SAME function, different embedding source, per the issue
brief's "dataset-agnostic" requirement. Mirrors map_eval.py's own
pure-math, dataset-agnostic precedent for the detector's mAP.
"""
import math
from typing import Dict, List, Sequence, TypedDict


class GalleryEntry(TypedDict):
    printing_id: str
    embedding: Sequence[float]


def cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    if len(a) != len(b):
        raise ValueError(f"cosine_similarity: dimension mismatch ({len(a)} vs {len(b)})")
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


def rank_gallery(query_embedding: Sequence[float], gallery: List[GalleryEntry]) -> List[str]:
    """Returns gallery printing_ids sorted by cosine similarity to
    `query_embedding`, best match first. Ties broken by the gallery's own
    original order (Python's sort is stable) — never by printing_id
    string, which would silently bias accuracy toward alphabetically-early
    ids."""
    scored = [(cosine_similarity(query_embedding, entry["embedding"]), entry["printing_id"]) for entry in gallery]
    scored.sort(key=lambda pair: -pair[0])
    return [printing_id for _, printing_id in scored]


def topk_accuracy(gallery: List[GalleryEntry], queries: List[GalleryEntry], k_values: Sequence[int]) -> Dict[str, float]:
    """For each query, ranks the gallery by cosine similarity and checks
    whether the query's true printing_id appears within the top K ranked
    gallery entries, for every K in `k_values`. Returns {"top<K>": accuracy}
    per K, plus "queryCount". Raises on an empty query or gallery set (a
    silent "0 out of 0" would look identical to a real 0% — every single
    query failing)."""
    if not queries:
        raise ValueError("topk_accuracy: queries must not be empty")
    if not gallery:
        raise ValueError("topk_accuracy: gallery must not be empty")

    hits = {k: 0 for k in k_values}
    for query in queries:
        ranked = rank_gallery(query["embedding"], gallery)
        for k in k_values:
            if query["printing_id"] in ranked[:k]:
                hits[k] += 1

    result: Dict[str, float] = {f"top{k}": hits[k] / len(queries) for k in k_values}
    result["queryCount"] = len(queries)
    return result
