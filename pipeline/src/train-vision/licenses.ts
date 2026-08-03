/**
 * License identifiers for the OBB detector run manifest (APP-027,
 * SPEC-APP.md §5, §13 Invariant 9). TS-side mirror of train_vision/
 * licenses.py's ARCHITECTURE_LICENSES + validate_licenses — kept in sync
 * manually (both sides are static facts about a fixed dependency chain,
 * same as export/licenses.ts's own static BASE_MODEL_LICENSE constant;
 * see that module's doc comment for the same "documented, not re-derived
 * per run" stance). validateLicenses is the manifest builder's hard gate:
 * an empty, unrecognized, or copyleft identifier refuses to build a
 * manifest at all, rather than shipping a wrong license silently.
 */
import type { VisionLicenses } from "./types.js";

export const ARCHITECTURE_LICENSES: VisionLicenses = {
  trainingCode: "MIT",
  torch: "BSD-3-Clause",
  torchvision: "BSD-3-Clause",
  litertTorch: "Apache-2.0",
  aiEdgeLitert: "Apache-2.0",
  litertConverter: "Apache-2.0",
};

const ALLOWED_LICENSES = new Set(["MIT", "Apache-2.0", "BSD-3-Clause", "BSD-2-Clause"]);
const COPYLEFT_PATTERN = /gpl/i;

export function validateLicenses(licenses: Record<string, string>): void {
  for (const [name, value] of Object.entries(licenses)) {
    if (value == null || typeof value !== "string" || value.trim() === "") {
      throw new Error(`license field "${name}" is empty/missing — every recorded license must be a real, non-empty string`);
    }
    if (COPYLEFT_PATTERN.test(value)) {
      throw new Error(
        `license field "${name}" = "${value}" names a copyleft (GPL family) license — ` +
          "SPEC-APP.md §13 Invariant 9 excludes AGPL/GPL for any shipped artifact.",
      );
    }
    if (!ALLOWED_LICENSES.has(value)) {
      throw new Error(
        `license field "${name}" = "${value}" is not on the allowlist (${[...ALLOWED_LICENSES].sort().join(", ")}) — ` +
          "verify the real license and add it deliberately, don't guess.",
      );
    }
  }
}
