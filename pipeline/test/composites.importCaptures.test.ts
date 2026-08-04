import { describe, it, expect } from "vitest";
import { classifyFraming, importCaptures, validateBroadcastImportConfig } from "../src/composites/importCaptures.js";
import type { ImportBackgroundsIO } from "../src/composites/importBackgrounds.js";
import type { BroadcastImportConfig } from "../src/composites/importCaptures.js";

// #256: tournament-broadcast capture importer. Reuses importBackgrounds.ts's
// exact decode/hash/dedupe/skip discipline (imported directly, not
// reimplemented) and layers ONE new thing on top: a `framing` classification
// per capture, derived from a documented, config-driven aspect-ratio rule —
// never a hand-classified per-file lookup table (37 real files is exactly
// the kind of corpus a hardcoded table would silently go stale on).
//
// Threshold rationale (measured against the real 37-file corpus, see
// config/broadcast-import.json's own doc string): full-broadcast frames
// measured ~1.76-1.79 aspect ratio; play-area-crop frames measured
// ~1.15-1.19 — a wide, unambiguous gap, so any threshold comfortably inside
// it (this test uses 1.4, matching the committed default) classifies every
// real file correctly with margin to spare on both sides.

function fakePng(byte: number): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, byte]);
}

const CONFIG: BroadcastImportConfig = { fullBroadcastMinAspectRatio: 1.4 };

describe("validateBroadcastImportConfig", () => {
  it("accepts a well-formed config", () => {
    const result = validateBroadcastImportConfig({ fullBroadcastMinAspectRatio: 1.4 });
    expect(result.valid).toBe(true);
  });

  it("rejects a non-object", () => {
    expect(validateBroadcastImportConfig(null).valid).toBe(false);
    expect(validateBroadcastImportConfig("nope").valid).toBe(false);
  });

  it("rejects a missing/non-positive fullBroadcastMinAspectRatio", () => {
    expect(validateBroadcastImportConfig({}).valid).toBe(false);
    expect(validateBroadcastImportConfig({ fullBroadcastMinAspectRatio: 0 }).valid).toBe(false);
    expect(validateBroadcastImportConfig({ fullBroadcastMinAspectRatio: -1 }).valid).toBe(false);
    expect(validateBroadcastImportConfig({ fullBroadcastMinAspectRatio: "1.4" }).valid).toBe(false);
  });
});

describe("classifyFraming", () => {
  it("classifies a wide (>= threshold) frame as full-broadcast", () => {
    expect(classifyFraming(2180, 1228, CONFIG)).toBe("full-broadcast"); // 1.775
    expect(classifyFraming(3022, 1696, CONFIG)).toBe("full-broadcast"); // 1.782
  });

  it("classifies a narrower (< threshold) frame as play-area-crop", () => {
    expect(classifyFraming(1370, 1152, CONFIG)).toBe("play-area-crop"); // 1.189
    expect(classifyFraming(1340, 1150, CONFIG)).toBe("play-area-crop"); // 1.165
  });

  it("is inclusive at exactly the threshold (>= reads as full-broadcast)", () => {
    expect(classifyFraming(140, 100, CONFIG)).toBe("full-broadcast"); // exactly 1.4
  });

  it("is a pure function of width/height/config — never touches rng or fs", () => {
    // same inputs -> same output, called repeatedly, no hidden state
    for (let i = 0; i < 5; i++) {
      expect(classifyFraming(2180, 1228, CONFIG)).toBe("full-broadcast");
    }
  });

  // #256 scope correction: the tournament-caps corpus turned out to span TWO
  // physically different rigs (Calling Edinburgh + Pro Tour Las Vegas —
  // different mat color/chrome palette, same structural camera framing).
  // The SAME threshold must hold for both, independently verified — not
  // assumed to generalize from the first rig alone.
  it("classifies real Pro Tour Las Vegas dimensions correctly too — the threshold is not tuned to a single rig", () => {
    expect(classifyFraming(2192, 1246, CONFIG)).toBe("full-broadcast"); // 1.759
    expect(classifyFraming(2194, 1232, CONFIG)).toBe("full-broadcast"); // 1.781
    expect(classifyFraming(1342, 1148, CONFIG)).toBe("play-area-crop"); // 1.169
  });
});

describe("importCaptures", () => {
  it("imports every recognized file with importBackgrounds's exact hash/dedupe discipline, plus a framing field", async () => {
    const written = new Map<string, Buffer>();
    const io: ImportBackgroundsIO = {
      listDir: () => ["full-a.png", "crop-a.png"],
      ensureDir: () => {},
      writeFile: (p, data) => written.set(p, data),
      normalizeImage: async (filePath) =>
        filePath.endsWith("full-a.png") ? { png: fakePng(1), width: 2180, height: 1228 } : { png: fakePng(2), width: 1370, height: 1152 },
    };
    const result = await importCaptures("/src", "/out", CONFIG, io);

    expect(result.imported).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
    const full = result.imported.find((c) => c.sourceFile === "full-a.png")!;
    const crop = result.imported.find((c) => c.sourceFile === "crop-a.png")!;
    expect(full.framing).toBe("full-broadcast");
    expect(crop.framing).toBe("play-area-crop");
    // The underlying importBackgrounds behavior (hash naming, write calls)
    // must still hold unchanged.
    expect(full.outputFileName).toBe(`${full.contentHash}.png`);
    expect(written.has(`/out/${full.outputFileName}`)).toBe(true);
  });

  it("passes through skipped files unchanged (importBackgrounds's own skip discipline, no reclassification attempted)", async () => {
    const io: ImportBackgroundsIO = {
      listDir: () => ["notes.txt"],
      ensureDir: () => {},
      writeFile: () => {},
      normalizeImage: async () => ({ png: fakePng(1), width: 1, height: 1 }),
    };
    const result = await importCaptures("/src", "/out", CONFIG, io);
    expect(result.imported).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].sourceFile).toBe("notes.txt");
  });

  it("REGRESSION LOCK: a genuinely square/near-square frame stays classified play-area-crop, never misfires to full-broadcast", async () => {
    // Guards against a threshold regression (e.g. an accidental swap of the
    // comparison direction, or a threshold silently dropped to <=1.0) that
    // would misclassify a crop as a full frame.
    const io: ImportBackgroundsIO = {
      listDir: () => ["square.png"],
      ensureDir: () => {},
      writeFile: () => {},
      normalizeImage: async () => ({ png: fakePng(1), width: 1000, height: 1000 }),
    };
    const result = await importCaptures("/src", "/out", CONFIG, io);
    expect(result.imported[0].framing).toBe("play-area-crop");
  });
});
