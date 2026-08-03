#!/usr/bin/env python3
"""torch -> int8 tflite export for the recognition embedder (APP-028,
SPEC-APP.md §8.7d). Two-stage post-training quantization, decoupled from
litert_torch.convert()'s own quant_config argument:

  1. Export the (already-trained) ArcFaceEmbedder to a PLAIN FLOAT32
     tflite via litert_torch.convert(model, sample) — the exact same
     one-hop chain train_vision/export.py already uses for the detector.
  2. Run `ai_edge_quantizer.Quantizer` (Google AI Edge, Apache-2.0) over
     the float tflite with the `static_wi8_ai8` recipe (int8 weights +
     int8 activations), calibrated against a representative sample of
     real APP-026 composite crops (embed_dataset.py + the same crop path
     embed_torch_data.py's training loop uses, so calibration statistics
     match real inference inputs).

A DECISION THIS ISSUE'S BRIEF DIDN'T COVER: the "obvious" path — pass a
PT2E `QuantConfig` straight into `litert_torch.convert()` (mirroring
train_vision/export.py's detector chain, just with a quant_config added)
— is BROKEN in this repo's currently pinned litert-torch/torchao/torch
version combination: `torch.export.export -> prepare_pt2e -> calibrate ->
convert_pt2e -> litert_torch.convert(..., quant_config=...)` fails at the
MLIR converter-passes stage with
`'stablehlo.uniform_dequantize' op operand #0 must be ranked tensor of
per-tensor integer quantized or per-axis integer quantized values`,
reproduced independently on a bare `nn.Linear` model (not this package's
architecture) — a real toolchain incompatibility, not a bug in this
package's model code. The `ai_edge_quantizer` path above was verified
end-to-end in this repo's actual venv (float export -> calibrate ->
quantize -> int8 tflite loads, correct int8 in/out dtype) before being
adopted here — see README.md for the full note.

The exported model's output is the PRE-L2-NORMALIZATION 256-d feature
vector (int8-quantized) — see embed_model.py's `EmbedderForExport` doc
comment for why L2-normalize is deliberately excluded from the shipped
graph. Application code must dequantize (scale/zero_point from the tflite
output tensor's own quantization params) and L2-normalize before
cosine-similarity KNN.

Usage:
    python3 -m train_vision.embed_export --config <path-to-export-config.json>
"""
import argparse
import hashlib
import json
import os
import random
from typing import Any, Dict, List

import numpy as np
import torch
from PIL import Image

from .embed_config import validate_embed_export_config
from .embed_crop import compute_crop_box
from .embed_dataset import build_embed_dataset
from .embed_licenses import EMBEDDER_LICENSES
from .embed_model import ArcFaceEmbedder, EmbedderForExport
from .embed_pixels import crop_with_neutral_padding
from .licenses import validate_licenses

QUANT_RECIPE_NAME = "static_wi8_ai8"


def _load_embedder(checkpoint_path: str, embedding_dim: int) -> ArcFaceEmbedder:
    embedder = ArcFaceEmbedder(embedding_dim=embedding_dim)
    checkpoint = torch.load(checkpoint_path, map_location="cpu")
    state_dict = checkpoint["embedder"] if isinstance(checkpoint, dict) and "embedder" in checkpoint else checkpoint
    embedder.load_state_dict(state_dict)
    embedder.eval()
    return embedder


def build_representative_inputs(dataset_dir: str, crop_size: int, num_samples: int, seed: int = 0) -> List[torch.Tensor]:
    """Real APP-026 composite crops (the same crop path training uses),
    so the quantizer's calibration statistics reflect real inference
    inputs rather than synthetic noise. Deterministic subset given `seed`;
    raises if the dataset has fewer crops than requested rather than
    silently calibrating on a smaller-than-configured sample."""
    samples = build_embed_dataset(dataset_dir)
    if len(samples) < num_samples:
        raise ValueError(f"build_representative_inputs: dataset at {dataset_dir} has only {len(samples)} card crops, need {num_samples}")
    chosen = random.Random(seed).sample(samples, num_samples)

    tensors = []
    for sample in chosen:
        image = Image.open(sample["image_path"]).convert("RGB")
        arr = np.asarray(image, dtype=np.uint8)
        box = compute_crop_box(sample["corners"])
        cropped = crop_with_neutral_padding(arr, box)
        resized = Image.fromarray(cropped).resize((crop_size, crop_size), Image.BILINEAR)
        resized_arr = np.asarray(resized, dtype=np.float32) / 255.0
        tensors.append(torch.from_numpy(resized_arr).permute(2, 0, 1).contiguous().unsqueeze(0))
    return tensors


def export_to_int8_tflite(checkpoint_path: str, embedding_dim: int, crop_size: int, representative_inputs: List[torch.Tensor], output_path: str) -> str:
    import litert_torch  # imported lazily: only export.py needs this heavy dep
    from ai_edge_quantizer import quantizer as aeq_quantizer
    from ai_edge_quantizer import recipe as aeq_recipe

    embedder = _load_embedder(checkpoint_path, embedding_dim)
    export_module = EmbedderForExport(embedder)
    sample_input = (torch.zeros(1, 3, crop_size, crop_size),)

    edge_model = litert_torch.convert(export_module, sample_input)
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    float_path = output_path + ".float.tflite"
    edge_model.export(float_path)

    from ai_edge_litert.interpreter import Interpreter

    interp = Interpreter(model_path=float_path)
    interp.allocate_tensors()
    sigs = interp.get_signature_list()
    sig_key = next(iter(sigs))
    input_arg_name = sigs[sig_key]["inputs"][0]

    q = aeq_quantizer.Quantizer(float_path, aeq_recipe.static_wi8_ai8())
    calibration_data = {sig_key: [{input_arg_name: t.numpy()} for t in representative_inputs]}
    calibration_result = q.calibrate(calibration_data)
    result = q.quantize(calibration_result)
    result.export_model(output_path, overwrite=True)

    os.remove(float_path)
    return output_path


def verify_int8_tflite_loads(tflite_path: str, expected_embedding_dim: int) -> Dict[str, Any]:
    """The LOCAL half of the "tflite loads on device" AC (mirrors
    export.py's verify_tflite_loads for the detector): loads the exported
    int8 file in the LiteRT/TF-Lite Python interpreter, runs one forward
    pass, and asserts the OUTPUT is genuinely int8-typed with the
    configured embedding dimension — never just "it didn't crash"."""
    from ai_edge_litert.interpreter import Interpreter

    interpreter = Interpreter(model_path=tflite_path)
    interpreter.allocate_tensors()
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()

    zero_input = np.zeros(input_details[0]["shape"], dtype=input_details[0]["dtype"])
    interpreter.set_tensor(input_details[0]["index"], zero_input)
    interpreter.invoke()
    output = interpreter.get_tensor(output_details[0]["index"])

    if output.dtype != np.int8:
        raise ValueError(f"verify_int8_tflite_loads: expected int8 output, got {output.dtype} — the export did not actually produce an int8-quantized model")
    if output.shape != (1, expected_embedding_dim):
        raise ValueError(f"verify_int8_tflite_loads: expected output shape (1, {expected_embedding_dim}), got {output.shape}")

    return {"loaded": True, "outputDtype": str(output.dtype), "outputShape": list(output.shape)}


def sha256_file(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def export_from_config(config: Dict[str, Any], verify_load: bool = True) -> Dict[str, Any]:
    representative_inputs = build_representative_inputs(
        config["representativeDatasetDir"], config["cropSize"], config["numRepresentativeSamples"]
    )
    output_path = export_to_int8_tflite(
        config["checkpointPath"], config["embeddingDim"], config["cropSize"], representative_inputs, config["outputPath"]
    )

    export_licenses = dict(EMBEDDER_LICENSES)
    validate_licenses(export_licenses)

    load_result = verify_int8_tflite_loads(output_path, config["embeddingDim"]) if verify_load else None

    summary = {
        "architecture": config["architecture"],
        "embeddingDim": config["embeddingDim"],
        "quantization": {"recipe": QUANT_RECIPE_NAME, "representativeSamples": len(representative_inputs)},
        "file": output_path,
        "sha256": sha256_file(output_path),
        "sizeBytes": os.path.getsize(output_path),
        "licenses": export_licenses,
        "localTfliteLoad": {
            **(load_result or {"loaded": None}),
            "note": "Local LiteRT/TF-Lite Python interpreter load only — the on-device fast-tflite (React Native) "
            "load is QA-gated separately (issue #140 scope note: TestFlight channel blocked on a human decision). "
            "Output is the PRE-L2-normalization embedding — application code dequantizes + L2-normalizes before "
            "cosine-similarity KNN (see this module's doc comment).",
        },
    }
    summary_path = os.path.join(os.path.dirname(output_path) or ".", "embed-export-summary.json")
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
        f.write("\n")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Export a trained APP-028 ArcFace embedder checkpoint to int8 tflite.")
    parser.add_argument("--config", required=True, help="Path to a JSON export config file (see embed_config.py's validate_embed_export_config).")
    parser.add_argument("--no-verify-load", action="store_true", help="Skip the local tflite-interpreter load smoke check.")
    args = parser.parse_args()

    with open(args.config, "r", encoding="utf-8") as f:
        raw_config = json.load(f)
    result = validate_embed_export_config(raw_config)
    if not result.valid:
        raise SystemExit("invalid export config:\n" + "\n".join(f"  - {e}" for e in result.errors))

    summary = export_from_config(result.config, verify_load=not args.no_verify_load)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
