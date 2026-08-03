// APP-029 (issue #141): the CLI's --config JSON file is plain JSON, but
// BuildFullPackInput's textEmbeddings/imageEmbeddings carry a `records:
// Map<...>` — not JSON-representable directly. parseDryRunConfigJson
// converts the JSON-friendly array-of-records shape into the real Map the
// knowledge-pack builder expects, so a config file can actually drive a
// full knowledge-pack build end to end (not just model packs, whose
// artifact maps are already plain JSON-safe objects).
import { describe, it, expect } from "vitest";
import { parseDryRunConfigJson } from "../src/publish/config.js";

describe("parseDryRunConfigJson", () => {
  it("converts a provided textEmbeddings array-of-records into a real Map", () => {
    const config = parseDryRunConfigJson({
      corpusSnapshotManifestRaw: { some: "manifest" },
      modelPacks: [],
      knowledgeFull: {
        input: {
          version: "1.0.0",
          corpusSnapshotHash: "d".repeat(64),
          chunks: [],
          printingIds: [],
          previousRegistry: null,
          registryVersion: "1.0.0",
          textEmbeddings: {
            provided: true,
            embedderVersion: "text-embed-v1",
            dim: 3,
            records: [{ chunkId: "a", vector: [0.1, 0.2, 0.3] }],
          },
          imageEmbeddings: { provided: false, embedderVersion: "unset", reason: "not provided" },
          calibration: { embedderVersion: "text-embed-v1", retrievalFloor: 0.4, oodThreshold: 0.2, computedAt: "x", sampleSize: 1, method: "x" },
        },
      },
    });

    const textEmbeddings = config.knowledgeFull!.input.textEmbeddings;
    expect(textEmbeddings.provided).toBe(true);
    if (!textEmbeddings.provided) throw new Error("unreachable");
    expect(textEmbeddings.records).toBeInstanceOf(Map);
    expect(textEmbeddings.records.get("a")).toEqual({ chunkId: "a", vector: [0.1, 0.2, 0.3] });
  });

  it("leaves an absent (provided: false) textEmbeddings/imageEmbeddings untouched", () => {
    const config = parseDryRunConfigJson({
      corpusSnapshotManifestRaw: { some: "manifest" },
      modelPacks: [],
      knowledgeFull: {
        input: {
          version: "1.0.0",
          corpusSnapshotHash: "d".repeat(64),
          chunks: [],
          printingIds: [],
          previousRegistry: null,
          registryVersion: "1.0.0",
          textEmbeddings: { provided: false, embedderVersion: "unembedded", reason: "no embedder yet" },
          imageEmbeddings: { provided: false, embedderVersion: "unset", reason: "not provided" },
          calibration: { embedderVersion: "unembedded", retrievalFloor: 0.4, oodThreshold: 0.2, computedAt: "x", sampleSize: 1, method: "x" },
        },
      },
    });

    expect(config.knowledgeFull!.input.textEmbeddings).toEqual({ provided: false, embedderVersion: "unembedded", reason: "no embedder yet" });
  });

  it("passes modelPacks and corpusSnapshotManifestRaw through unchanged", () => {
    const modelPacks = [{ tier: "0.6B" as const, input: { artifacts: { mergedGguf: null, textEmbedderGguf: null, detectorTflite: null, visionEmbedderTflite: null } } }];
    const config = parseDryRunConfigJson({ corpusSnapshotManifestRaw: { a: 1 }, modelPacks });
    expect(config.corpusSnapshotManifestRaw).toEqual({ a: 1 });
    expect(config.modelPacks).toEqual(modelPacks);
  });

  it("passes a knowledgeDelta from/to pair through unchanged (no Map involved — SnapshotForDelta has no embeddings)", () => {
    const knowledgeDelta = {
      from: { version: "1.0.0", chunks: [], printingIds: [], textEmbedderVersion: "v1", visionEmbedderVersion: "v1" },
      to: { version: "1.1.0", chunks: [], printingIds: [], textEmbedderVersion: "v1", visionEmbedderVersion: "v1" },
    };
    const config = parseDryRunConfigJson({ corpusSnapshotManifestRaw: {}, modelPacks: [], knowledgeDelta });
    expect(config.knowledgeDelta).toEqual(knowledgeDelta);
  });

  it("omits knowledgeFull entirely when the raw config has none", () => {
    const config = parseDryRunConfigJson({ corpusSnapshotManifestRaw: {}, modelPacks: [] });
    expect(config.knowledgeFull).toBeUndefined();
  });
});
