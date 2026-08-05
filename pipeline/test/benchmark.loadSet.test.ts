import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import sharp from "sharp";
import { loadBenchmarkPhotoSet, buildManifestFromDirs, attachFrameDimensions } from "../src/benchmark/loadSet.js";
import type { RawPhotoEntry } from "../src/benchmark/manifest.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-benchmark-loadset-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFixture(photosDir: string, labelsDir: string) {
  fs.mkdirSync(path.join(photosDir, "single"), { recursive: true });
  fs.mkdirSync(path.join(labelsDir, "single"), { recursive: true });
  fs.writeFileSync(path.join(photosDir, "single", "p1.jpg"), "fake-jpg-bytes");
  fs.writeFileSync(
    path.join(labelsDir, "single", "p1.json"),
    JSON.stringify({
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
          tags: [],
        },
      ],
    }),
  );
  // A photo with NO matching label file — must be reported, not silently dropped.
  fs.writeFileSync(path.join(photosDir, "single", "p2.jpg"), "fake-jpg-bytes-2");
  // A non-photo file that must be ignored by the walk entirely.
  fs.writeFileSync(path.join(photosDir, "single", "notes.txt"), "not a photo");
}

describe("loadBenchmarkPhotoSet", () => {
  it("pairs each photo with its same-relative-path label file", () => {
    const photosDir = path.join(tmpDir, "photos");
    const labelsDir = path.join(tmpDir, "labels");
    writeFixture(photosDir, labelsDir);

    const { entries, missingLabels } = loadBenchmarkPhotoSet(photosDir, labelsDir);

    expect(entries).toHaveLength(1);
    expect(entries[0].fileName).toBe("single/p1.jpg");
    expect(entries[0].labelRaw).toMatchObject({ photoId: "p1" });
    expect(missingLabels).toEqual(["single/p2.jpg"]);
  });

  it("records a malformed (non-JSON) label file as a parse error rather than throwing", () => {
    const photosDir = path.join(tmpDir, "photos");
    const labelsDir = path.join(tmpDir, "labels");
    fs.mkdirSync(photosDir, { recursive: true });
    fs.mkdirSync(labelsDir, { recursive: true });
    fs.writeFileSync(path.join(photosDir, "p1.jpg"), "photo-bytes");
    fs.writeFileSync(path.join(labelsDir, "p1.json"), "{not valid json");

    const { entries } = loadBenchmarkPhotoSet(photosDir, labelsDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].labelParseError).toBeTruthy();
    expect(entries[0].labelRaw).toBeUndefined();
  });

  it("returns empty results (no throw) for an empty/nonexistent photos dir", () => {
    const { entries, missingLabels } = loadBenchmarkPhotoSet(
      path.join(tmpDir, "does-not-exist"),
      path.join(tmpDir, "labels-does-not-exist"),
    );
    expect(entries).toEqual([]);
    expect(missingLabels).toEqual([]);
  });
});

describe("buildManifestFromDirs", () => {
  it("builds a manifest from a real photos+labels directory tree, recording the unlabeled photo as skipped", async () => {
    const photosDir = path.join(tmpDir, "photos");
    const labelsDir = path.join(tmpDir, "labels");
    writeFixture(photosDir, labelsDir);

    const { manifest } = await buildManifestFromDirs(photosDir, labelsDir);

    expect(manifest.photoCount).toBe(1);
    expect(manifest.skipped).toEqual([{ fileName: "single/p2.jpg", reason: "no matching label file" }]);
  });
});

// #286 follow-up: attachFrameDimensions is what lets buildManifestFromDirs
// (npm run benchmark:manifest, the tool a human runs right after labeling a
// batch) catch the orientation-mismatch defect too, not just the export
// path — it decodes each entry's REAL photo bytes (composites/imageIO.ts's
// decodeImageToRaw, the same now-EXIF-aware decoder #286 fixed) and
// attaches the resulting width/height so buildBenchmarkManifest's
// validateLabelFrame check has something to compare against.
describe("attachFrameDimensions", () => {
  it("attaches real decoded (EXIF-applied) width/height to an entry with a parseable label", async () => {
    // Genuine EXIF orientation tag — same withMetadata({orientation}) fixture
    // technique validated for decodeAndNormalizeBackground (PR #246) and
    // decodeImageToRaw (#286) — a fixture with no EXIF proves nothing here.
    const photoBytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 100 })
      .toBuffer();
    const entries: RawPhotoEntry[] = [
      { fileName: "single/p1.jpg", photoBytes, labelBytes: Buffer.from("{}"), labelRaw: { photoId: "p1" } },
    ];

    await attachFrameDimensions(entries);

    // Orientation 6 swaps the raw 20x10 buffer to a displayed 10x20 frame —
    // exactly the transposed dims the fix in decodeImageToRaw now returns.
    expect(entries[0].frameWidth).toBe(10);
    expect(entries[0].frameHeight).toBe(20);
  });

  it("leaves frameWidth/frameHeight unset (never throws) for an entry with no parseable label — nothing to validate a frame against", async () => {
    const entries: RawPhotoEntry[] = [
      { fileName: "broken/p2.jpg", photoBytes: Buffer.from("irrelevant"), labelBytes: Buffer.from("not json"), labelParseError: "boom" },
    ];
    await attachFrameDimensions(entries);
    expect(entries[0].frameWidth).toBeUndefined();
    expect(entries[0].frameHeight).toBeUndefined();
  });

  it("leaves frameWidth/frameHeight unset (never throws, never aborts the batch) when the photo bytes aren't a real decodable image", async () => {
    // Mirrors this file's own writeFixture()/entry() convention elsewhere
    // of using plain non-image bytes for lightweight I/O-pairing fixtures —
    // a decode failure here must degrade gracefully (frame check simply
    // doesn't run for this one entry), not crash the whole manifest build.
    const entries: RawPhotoEntry[] = [
      { fileName: "single/p1.jpg", photoBytes: Buffer.from("fake-jpg-bytes"), labelBytes: Buffer.from("{}"), labelRaw: { photoId: "p1" } },
      { fileName: "single/p2.jpg", photoBytes: Buffer.from("also-fake"), labelBytes: Buffer.from("{}"), labelRaw: { photoId: "p2" } },
    ];
    await expect(attachFrameDimensions(entries)).resolves.toBeUndefined();
    expect(entries[0].frameWidth).toBeUndefined();
    expect(entries[1].frameWidth).toBeUndefined();
  });
});
