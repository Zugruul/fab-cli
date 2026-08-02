import { validKnowledgePackManifest } from "@fab/manifest-schema";
import { readRetrievalFloors } from "../floors";

// §9.7: "The retrieval-confidence abstention floor SHALL be calibrated per
// embedder version against the eval set (not hardcoded)." Same for §10.9's
// oodThreshold. These tests exist specifically to catch a regression where
// someone hardcodes a constant instead of reading the active manifest.

describe("readRetrievalFloors", () => {
  it("reads retrievalFloor and oodThreshold straight from the knowledge-pack manifest", () => {
    const floors = readRetrievalFloors(validKnowledgePackManifest);
    expect(floors.retrievalFloor).toBe(validKnowledgePackManifest.retrievalFloor);
    expect(floors.oodThreshold).toBe(validKnowledgePackManifest.oodThreshold);
  });

  it("tracks a differently-calibrated manifest instead of returning a fixed constant", () => {
    const recalibrated = {
      ...validKnowledgePackManifest,
      retrievalFloor: 0.77,
      oodThreshold: 0.05,
    };

    const floors = readRetrievalFloors(recalibrated);

    expect(floors).toEqual({ retrievalFloor: 0.77, oodThreshold: 0.05 });
    // and definitely not silently equal to the OTHER manifest's values
    expect(floors.retrievalFloor).not.toBe(validKnowledgePackManifest.retrievalFloor);
  });
});
