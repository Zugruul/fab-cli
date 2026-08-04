/**
 * APP-029 (SPEC-APP.md §8.9; issue #141): resolves a REAL producer
 * manifest's recorded file entry into a real local path on disk. These
 * adapters are intentionally thin — they resolve a *path*, nothing more
 * (in particular, they never invent a licenseId: license attribution
 * stays an explicit, human-supplied decision everywhere else in this
 * pipeline, e.g. export/licenses.ts, and the model-pack assembler keeps
 * that convention rather than inferring a license from a training-code/
 * dependency license breakdown).
 *
 * Path conventions mirror each producer's own runner:
 *  - export/runner.ts's doc comment: export-runs/<runId> holds a
 *    gitignored `gguf/` pulled from the remote job. A manifest's
 *    `artifacts.files[].file` entry may be an absolute path (as pulled
 *    from the remote host) or a bare/relative name — the latter is
 *    resolved under `<runDir>/gguf/`.
 *  - train-vision/runner.ts + embedRunner.ts's OUTPUT_SUBDIR: both
 *    vision-runs/<runId> layouts hold a gitignored `output/` with
 *    tfliteFiles entries keyed by bare file name.
 */
import fs from "node:fs";
import path from "node:path";
import type { ExportRunManifest } from "../export/types.js";
import type { VisionRunManifest } from "../train-vision/types.js";
import type { EmbedRunManifest } from "../train-vision/embedTypes.js";

function assertExists(filePath: string, describe: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${describe}: resolved path "${filePath}" does not exist — the assembler never fabricates an artifact for a manifest entry with no real file behind it`);
  }
  return filePath;
}

export function resolveMergedGgufPath(manifest: ExportRunManifest, runDir: string, quantization: string): string {
  const files = manifest.artifacts.files;
  const entry = files.find((f) => f.quantization === quantization);
  if (!entry) {
    const available = files.length > 0 ? files.map((f) => f.quantization).join(", ") : "none produced";
    throw new Error(
      `resolveMergedGgufPath: export run "${manifest.runId}" has no artifact for quantization "${quantization}" (available: ${available})`,
    );
  }
  const resolved = path.isAbsolute(entry.file) ? entry.file : path.join(runDir, "gguf", entry.file);
  return assertExists(resolved, `resolveMergedGgufPath: export run "${manifest.runId}" quantization "${quantization}"`);
}

/** Shared by the detector and vision-embedder resolvers below — both
 * producers record `artifacts.tfliteFiles: {name, sha256}[]` under the
 * same `<runDir>/output/` layout, so the disambiguation/existence logic is
 * identical; only the manifest type and the human-facing label differ. */
function resolveSoleTflitePath(tfliteFiles: { name: string }[], runId: string, runDir: string, label: string): string {
  if (tfliteFiles.length === 0) {
    throw new Error(`resolve${label}TflitePath: run "${runId}" has produced no tflite files yet (QA-gated — see SPEC-APP.md §8.7 note on real-photo-benchmark gating)`);
  }
  if (tfliteFiles.length > 1) {
    throw new Error(
      `resolve${label}TflitePath: run "${runId}" is ambiguous — it produced ${tfliteFiles.length} tflite files (${tfliteFiles.map((f) => f.name).join(", ")}); this resolver never silently picks one`,
    );
  }
  const resolved = path.join(runDir, "output", tfliteFiles[0].name);
  return assertExists(resolved, `resolve${label}TflitePath: run "${runId}"`);
}

export function resolveDetectorTflitePath(manifest: VisionRunManifest, runDir: string): string {
  return resolveSoleTflitePath(manifest.artifacts.tfliteFiles, manifest.runId, runDir, "Detector");
}

export function resolveVisionEmbedderTflitePath(manifest: EmbedRunManifest, runDir: string): string {
  return resolveSoleTflitePath(manifest.artifacts.tfliteFiles, manifest.runId, runDir, "VisionEmbedder");
}
