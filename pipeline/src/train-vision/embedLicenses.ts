/**
 * License identifiers for the recognition embedder's run manifest
 * (APP-028, SPEC-APP.md §5, §13 Invariant 9). TS-side mirror of
 * train_vision/embed_licenses.py's EMBEDDER_LICENSES — kept in sync
 * manually (both sides are static facts about a fixed dependency chain,
 * same as licenses.ts's/export/licenses.ts's own stance). Validation
 * itself is NOT duplicated here — callers use licenses.ts's generic
 * validateLicenses (it takes any Record<string,string>, no
 * detector-specific assumptions), exactly as embed_licenses.py reuses
 * licenses.py's validate_licenses on the Python side.
 */
import type { EmbedLicenses } from "./embedTypes.js";

export const EMBEDDER_LICENSES: EmbedLicenses = {
  trainingCode: "MIT",
  torch: "BSD-3-Clause",
  litertTorch: "Apache-2.0",
  aiEdgeLitert: "Apache-2.0",
  litertConverter: "Apache-2.0",
  aiEdgeQuantizer: "Apache-2.0",
};
