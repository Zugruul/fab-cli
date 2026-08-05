import { describe, it, expect } from "vitest";
import { buildBenchmarkManifest, sha256 } from "../src/benchmark/manifest.js";
import { LABEL_SCHEMA_VERSION } from "../src/benchmark/types.js";
import type { RawPhotoEntry } from "../src/benchmark/manifest.js";
import type { PhotoLabel } from "../src/benchmark/types.js";

// Issue #274: the full tag vocabulary, hardcoded here (not derived from
// QUAD_TAGS) so a future accidental edit to QUAD_TAGS that drops/renames a
// tag is caught by this test failing, rather than silently adjusting the
// expectation to match.
const ZERO_COUNTS_BY_TAG = {
  sleeved: 0,
  foil: 0,
  glare: 0,
  "cold-foil": 0,
  "rainbow-foil": 0,
  "gold-foil": 0,
  marvel: 0,
  promo: 0,
  "alternate-art": 0,
  "alternate-border": 0,
  "extended-art": 0,
  "full-art": 0,
  "alternate-text": 0,
};

function label(overrides: Partial<PhotoLabel> = {}): PhotoLabel {
  return {
    photoId: "p1",
    fileName: "single/p1.jpg",
    sceneType: "single",
    orientation: "portrait",
    quads: [
      {
        printingId: "pr1",
        corners: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
        tags: ["foil"],
      },
    ],
    ...overrides,
  };
}

function entry(overrides: Partial<RawPhotoEntry> = {}): RawPhotoEntry {
  const l = label();
  const labelBytes = Buffer.from(JSON.stringify(l));
  return {
    fileName: "single/p1.jpg",
    photoBytes: Buffer.from("fake-photo-bytes"),
    labelBytes,
    labelRaw: l,
    ...overrides,
  };
}

describe("buildBenchmarkManifest", () => {
  it("builds one manifest entry per valid photo with content + label hashes", () => {
    const manifest = buildBenchmarkManifest({ entries: [entry()], now: () => "2026-01-01T00:00:00.000Z" });
    expect(manifest.photoCount).toBe(1);
    expect(manifest.photos[0]).toEqual({
      photoId: "p1",
      fileName: "single/p1.jpg",
      sceneType: "single",
      orientation: "portrait",
      quadCount: 1,
      photoContentHash: sha256(Buffer.from("fake-photo-bytes")),
      labelFileHash: sha256(Buffer.from(JSON.stringify(label()))),
    });
    expect(manifest.skipped).toEqual([]);
    expect(manifest.buildDate).toBe("2026-01-01T00:00:00.000Z");
  });

  it("hashes the label file's actual on-disk bytes, not a re-serialization of the parsed object", () => {
    // Deliberately mismatched formatting between labelBytes and labelRaw's
    // canonical JSON.stringify — the hash must reflect the real file bytes.
    const l = label();
    const prettyBytes = Buffer.from(JSON.stringify(l, null, 2));
    const manifest = buildBenchmarkManifest({ entries: [{ ...entry(), labelBytes: prettyBytes }] });
    expect(manifest.photos[0].labelFileHash).toBe(sha256(prettyBytes));
    expect(manifest.photos[0].labelFileHash).not.toBe(sha256(Buffer.from(JSON.stringify(l))));
  });

  it("aggregates counts by scene type and by quad tag across multiple photos", () => {
    const e2 = entry({
      fileName: "field/p2.jpg",
      labelRaw: label({
        photoId: "p2",
        fileName: "field/p2.jpg",
        sceneType: "field",
        orientation: "landscape",
        quads: [
          {
            printingId: "a",
            corners: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 1, y: 1 },
              { x: 0, y: 1 },
            ],
            tags: ["glare", "sleeved"],
          },
          {
            printingId: "b",
            corners: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 1, y: 1 },
              { x: 0, y: 1 },
            ],
            tags: [],
          },
        ],
      }),
    });
    const manifest = buildBenchmarkManifest({ entries: [entry(), e2] });
    expect(manifest.photoCount).toBe(2);
    expect(manifest.countsBySceneType).toEqual({ single: 1, field: 1, binder: 0 });
    expect(manifest.countsByTag).toEqual({ ...ZERO_COUNTS_BY_TAG, sleeved: 1, foil: 1, glare: 1 });
  });

  it("counts the extended treatment/rarity tags too, not just the original three (issue #274)", () => {
    const e2 = entry({
      fileName: "field/p2.jpg",
      labelRaw: label({
        photoId: "p2",
        fileName: "field/p2.jpg",
        sceneType: "field",
        orientation: "landscape",
        quads: [
          {
            printingId: "a",
            corners: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 1, y: 1 },
              { x: 0, y: 1 },
            ],
            tags: ["marvel", "cold-foil", "full-art"],
          },
        ],
      }),
    });
    const manifest = buildBenchmarkManifest({ entries: [e2] });
    expect(manifest.countsByTag).toEqual({ ...ZERO_COUNTS_BY_TAG, marvel: 1, "cold-foil": 1, "full-art": 1 });
  });

  it("skips an entry with a label parse error, recording the reason, without aborting the whole build", () => {
    const good = entry();
    const bad: RawPhotoEntry = {
      fileName: "broken/p3.jpg",
      photoBytes: Buffer.from("x"),
      labelBytes: Buffer.from("not json"),
      labelParseError: "Unexpected token o in JSON",
    };
    const manifest = buildBenchmarkManifest({ entries: [good, bad] });
    expect(manifest.photoCount).toBe(1);
    expect(manifest.skipped).toEqual([{ fileName: "broken/p3.jpg", reason: "invalid JSON: Unexpected token o in JSON" }]);
  });

  it("skips an entry that fails label validation, recording the specific validation error", () => {
    const bad = entry({ labelRaw: label({ sceneType: "tabletop" as PhotoLabel["sceneType"] }) });
    const manifest = buildBenchmarkManifest({ entries: [bad] });
    expect(manifest.photoCount).toBe(0);
    expect(manifest.skipped).toHaveLength(1);
    expect(manifest.skipped[0].fileName).toBe("single/p1.jpg");
    expect(manifest.skipped[0].reason).toMatch(/sceneType/);
  });

  it("stamps the manifest with schema + label-schema versions, even for an empty set", () => {
    const manifest = buildBenchmarkManifest({ entries: [] });
    expect(manifest.schemaVersion).toBeTruthy();
    expect(manifest.labelSchemaVersion).toBe(LABEL_SCHEMA_VERSION);
    expect(manifest.photoCount).toBe(0);
    expect(manifest.countsBySceneType).toEqual({ single: 0, field: 0, binder: 0 });
    expect(manifest.countsByTag).toEqual(ZERO_COUNTS_BY_TAG);
  });
});

describe("sha256", () => {
  it("is a deterministic hex digest of the given bytes", () => {
    const a = sha256(Buffer.from("hello"));
    const b = sha256(Buffer.from("hello"));
    const c = sha256(Buffer.from("world"));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches the known SHA-256 test vector for \"hello\" — pins the actual algorithm, not just its shape", () => {
    // A determinism + hex-format check alone would still pass a wrong
    // algorithm (e.g. sha1 zero-padded to 64 hex chars) or a truncated
    // digest — pinning a real, independently-verifiable vector catches
    // that (PR #235 review round 1, item 3).
    expect(sha256(Buffer.from("hello"))).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
});
