import type { KnowledgePackManifest } from "@fab/manifest-schema";
import type { RetrievalFloors } from "./types";

/**
 * §9.7/§10.9: retrievalFloor and oodThreshold are read straight from the
 * active knowledge-pack manifest — calibrated per embedder version against
 * the eval set — never hardcoded in app code. `KnowledgePackManifestSchema`
 * (in @fab/manifest-schema) already requires both fields to be present on
 * every shipped manifest.
 */
export function readRetrievalFloors(manifest: KnowledgePackManifest): RetrievalFloors {
  return { retrievalFloor: manifest.retrievalFloor, oodThreshold: manifest.oodThreshold };
}
