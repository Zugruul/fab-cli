import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadBenchmarkPhotoSet, buildManifestFromDirs } from "../src/benchmark/loadSet.js";

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
  it("builds a manifest from a real photos+labels directory tree, recording the unlabeled photo as skipped", () => {
    const photosDir = path.join(tmpDir, "photos");
    const labelsDir = path.join(tmpDir, "labels");
    writeFixture(photosDir, labelsDir);

    const { manifest } = buildManifestFromDirs(photosDir, labelsDir);

    expect(manifest.photoCount).toBe(1);
    expect(manifest.skipped).toEqual([{ fileName: "single/p2.jpg", reason: "no matching label file" }]);
  });
});
