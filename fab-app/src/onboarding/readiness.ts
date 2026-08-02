import type { AppReadiness, AppReadinessInput, FeatureAvailability } from "./types";

const CATALOG_ALWAYS_AVAILABLE: FeatureAvailability = { available: true };
const AVAILABLE: FeatureAvailability = { available: true };

function scanningAvailability(input: AppReadinessInput): FeatureAvailability {
  if (input.modelPack === "installed") {
    return AVAILABLE;
  }
  return {
    available: false,
    reason: "model pack not installed yet — card scanning needs the on-device detector (§11.5)",
  };
}

function qaAvailability(input: AppReadinessInput): FeatureAvailability {
  if (input.modelPack === "installed" && input.knowledgePack === "installed") {
    return AVAILABLE;
  }
  if (input.modelPack === "not-installed" && input.knowledgePack === "not-installed") {
    return {
      available: false,
      reason: "model pack and knowledge pack not installed yet — Q&A needs both to answer",
    };
  }
  if (input.modelPack === "not-installed") {
    return {
      available: false,
      reason: "model pack not installed yet — Q&A needs it to generate answers",
    };
  }
  return {
    available: false,
    reason: "knowledge pack not installed yet — Q&A needs it to retrieve sources",
  };
}

/**
 * §9.9 degraded-mode navigation: derives which features are usable from
 * what's currently installed. Catalog CRUD is model-free by design (§12.1
 * stores entries locally in op-sqlite with no model/knowledge dependency),
 * so it is always available. Q&A needs both packs (§10: generation from
 * the model pack, retrieval from the knowledge pack). Scanning needs only
 * the model pack (§11.5: detector + embedder load from the model pack, not
 * the knowledge pack). Every unavailable case carries a specific reason —
 * never a bare `available: false` — so screens render honest "not ready"
 * messaging instead of a generic error (§9.9).
 */
export function deriveAppReadiness(input: AppReadinessInput): AppReadiness {
  return {
    catalog: CATALOG_ALWAYS_AVAILABLE,
    qa: qaAvailability(input),
    scanning: scanningAvailability(input),
  };
}
