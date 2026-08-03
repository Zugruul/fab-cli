#!/usr/bin/env python3
"""torch -> tflite export (APP-027, SPEC-APP.md §8.7c). One hop:
torch.nn.Module -> litert_torch.convert(...).export(path) -> a
fast-tflite-loadable .tflite file. litert-torch (the ai-edge-torch
successor, see licenses.py) traces the model with `torch.export` under
the hood and lowers it directly to LiteRT's flatbuffer format — no
intermediate ONNX/TensorFlow SavedModel hop needed, which is why this
package doesn't declare onnx/tensorflow as dependencies at all (a shorter
dependency chain is a shorter license chain to verify, and less that can
silently start requiring GPL/AGPL bits down the line).

Usage:
    python3 -m train_vision.export --config <path-to-export-config.json>

Writes export-summary.json (file path, sha256, sizeBytes, licenses) next
to the produced .tflite file. Loading the exported file back in the local
TF Lite / LiteRT Python runtime (this script's own smoke check, run via
`--verify-load`) is the LOCAL half of §8.7c's AC ("tflite loads via
fast-tflite on device") — the on-device fast-tflite (React Native) load is
a separate, QA-gated leg per this issue's scope note (TestFlight channel
blocked on a human decision), not faked here.
"""
import argparse
import hashlib
import json
import os

import torch

from .config import validate_export_config
from .licenses import ARCHITECTURE_LICENSES, validate_licenses
from .model import ObbCenterNet


def export_to_tflite(checkpoint_path: str, stride: int, canvas_size: int, output_path: str) -> str:
    import litert_torch  # imported lazily: only export.py (never the pure/test-only modules) needs this heavy dep

    model = ObbCenterNet(stride=stride)
    state_dict = torch.load(checkpoint_path, map_location="cpu")
    model.load_state_dict(state_dict)
    model.eval()

    sample_input = (torch.zeros(1, 3, canvas_size, canvas_size),)
    edge_model = litert_torch.convert(model, sample_input)
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    edge_model.export(output_path)
    return output_path


def verify_tflite_loads(tflite_path: str) -> bool:
    """The LOCAL half of the "tflite loads" AC: loads the exported file in
    the LiteRT/TF-Lite Python interpreter and runs one forward pass on a
    zero tensor. Returns True/raises — never silently swallows a load
    failure (a broken export must fail the smoke, not report success)."""
    from ai_edge_litert.interpreter import Interpreter

    interpreter = Interpreter(model_path=tflite_path)
    interpreter.allocate_tensors()
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()
    interpreter.set_tensor(input_details[0]["index"], torch.zeros(*input_details[0]["shape"]).numpy())
    interpreter.invoke()
    for out in output_details:
        interpreter.get_tensor(out["index"])
    return True


def sha256_file(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def export_from_config(config: dict, verify_load: bool = True) -> dict:
    output_path = export_to_tflite(config["checkpointPath"], config["stride"], config["canvasSize"], config["outputPath"])

    export_licenses = {
        "torch": ARCHITECTURE_LICENSES["torch"],
        "litertTorch": ARCHITECTURE_LICENSES["litertTorch"],
        "aiEdgeLitert": ARCHITECTURE_LICENSES["aiEdgeLitert"],
        "litertConverter": ARCHITECTURE_LICENSES["litertConverter"],
    }
    validate_licenses(export_licenses)

    loaded_ok = None
    if verify_load:
        loaded_ok = verify_tflite_loads(output_path)

    summary = {
        "architecture": config["architecture"],
        "file": output_path,
        "sha256": sha256_file(output_path),
        "sizeBytes": os.path.getsize(output_path),
        "licenses": export_licenses,
        "localTfliteLoad": {
            "loaded": loaded_ok,
            "note": "Local LiteRT/TF-Lite Python interpreter load only — the on-device fast-tflite (React Native) "
            "load is QA-gated separately (issue #139 scope note: TestFlight channel blocked on a human decision).",
        },
    }
    summary_path = os.path.join(os.path.dirname(output_path) or ".", "export-summary.json")
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
        f.write("\n")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Export a trained APP-027 OBB checkpoint to tflite.")
    parser.add_argument("--config", required=True, help="Path to a JSON export config file (see config.py's validate_export_config).")
    parser.add_argument("--no-verify-load", action="store_true", help="Skip the local tflite-interpreter load smoke check.")
    args = parser.parse_args()

    with open(args.config, "r", encoding="utf-8") as f:
        raw_config = json.load(f)
    result = validate_export_config(raw_config)
    if not result.valid:
        raise SystemExit("invalid export config:\n" + "\n".join(f"  - {e}" for e in result.errors))

    summary = export_from_config(result.config, verify_load=not args.no_verify_load)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
