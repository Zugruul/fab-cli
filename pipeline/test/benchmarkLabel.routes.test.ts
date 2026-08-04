import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { listPhotos, getLabel, putLabel, PathEscapeError } from "../src/benchmark-label/routes.js";

let tmpDir: string;
let photosDir: string;
let labelsDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-benchmark-label-routes-test-"));
  photosDir = path.join(tmpDir, "photos");
  labelsDir = path.join(tmpDir, "photos", "labels");
  fs.mkdirSync(path.join(photosDir, "single"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function validLabel(overrides: Record<string, unknown> = {}) {
  return {
    photoId: "photo-001",
    fileName: "single/photo-001.jpg",
    sceneType: "single",
    orientation: "portrait",
    quads: [
      {
        printingId: "pr1",
        corners: [
          { x: 10, y: 10 },
          { x: 100, y: 10 },
          { x: 100, y: 200 },
          { x: 10, y: 200 },
        ],
        tags: ["sleeved"],
      },
    ],
    ...overrides,
  };
}

describe("listPhotos", () => {
  it("reports an unlabeled photo as unlabeled with quadCount 0", () => {
    fs.writeFileSync(path.join(photosDir, "single", "photo-001.jpg"), "fake-bytes");
    const entries = listPhotos(photosDir, labelsDir);
    expect(entries).toEqual([{ fileName: "single/photo-001.jpg", sceneTypeGuess: "single", labeled: false, quadCount: 0 }]);
  });

  it("reports a labeled photo's quad count", () => {
    fs.writeFileSync(path.join(photosDir, "single", "photo-001.jpg"), "fake-bytes");
    fs.mkdirSync(path.join(labelsDir, "single"), { recursive: true });
    fs.writeFileSync(path.join(labelsDir, "single", "photo-001.json"), JSON.stringify(validLabel()));

    const entries = listPhotos(photosDir, labelsDir);
    expect(entries).toEqual([{ fileName: "single/photo-001.jpg", sceneTypeGuess: "single", labeled: true, quadCount: 1 }]);
  });

  it("ignores non-photo files", () => {
    fs.writeFileSync(path.join(photosDir, "single", "notes.txt"), "not a photo");
    expect(listPhotos(photosDir, labelsDir)).toEqual([]);
  });
});

describe("getLabel", () => {
  it("returns null when no label file exists yet (fresh photo, nothing to resume)", () => {
    expect(getLabel(labelsDir, "single/photo-001.jpg")).toBeNull();
  });

  it("returns the existing label so the UI can hydrate/resume it", () => {
    fs.mkdirSync(path.join(labelsDir, "single"), { recursive: true });
    fs.writeFileSync(path.join(labelsDir, "single", "photo-001.json"), JSON.stringify(validLabel()));
    const label = getLabel(labelsDir, "single/photo-001.jpg");
    expect(label).toMatchObject({ photoId: "photo-001", quads: [{ printingId: "pr1" }] });
  });
});

describe("putLabel — validates via validatePhotoLabel before ever writing", () => {
  it("writes a valid label to labels/<scene>/<photoId>.json", () => {
    const result = putLabel(labelsDir, "single/photo-001.jpg", validLabel());
    expect(result.ok).toBe(true);

    const onDisk = JSON.parse(fs.readFileSync(path.join(labelsDir, "single", "photo-001.json"), "utf8"));
    expect(onDisk.photoId).toBe("photo-001");
  });

  it("rejects an invalid label (bad sceneType) and writes NOTHING to disk", () => {
    const result = putLabel(labelsDir, "single/photo-001.jpg", validLabel({ sceneType: "not-a-scene" }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(labelsDir, "single", "photo-001.json"))).toBe(false);
  });

  it("rejects a label with zero quads (validatePhotoLabel's own rule) rather than writing an empty label", () => {
    const result = putLabel(labelsDir, "single/photo-001.jpg", validLabel({ quads: [] }));
    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(labelsDir, "single", "photo-001.json"))).toBe(false);
  });

  // #258 hard requirement: a card cropped by the photo frame has corners
  // OUTSIDE the image bounds (negative, or beyond width/height) — the
  // amodal convention (pipeline/docs/benchmark-labeling.md, geometry.ts).
  // validatePhotoLabel deliberately does not bound-check corners; this tool
  // must not "fix" that by clamping before/while writing. A clamping bug
  // here silently corrupts ground truth and disagrees with the synthetic
  // generator's convention — this is a merge blocker per the issue.
  it("AMODAL: writes out-of-bounds corners (negative and beyond any plausible photo dimension) byte-for-byte unchanged — never clamped", () => {
    const amodalLabel = validLabel({
      quads: [
        {
          printingId: "pr-cropped",
          corners: [
            { x: -120.5, y: -30 }, // above/left of frame
            { x: 250, y: -30 },
            { x: 250, y: 900 },
            { x: -120.5, y: 900 },
          ],
          tags: [],
        },
      ],
    });

    const result = putLabel(labelsDir, "single/photo-001.jpg", amodalLabel);
    expect(result.ok).toBe(true);

    const onDisk = JSON.parse(fs.readFileSync(path.join(labelsDir, "single", "photo-001.json"), "utf8"));
    expect(onDisk.quads[0].corners).toEqual([
      { x: -120.5, y: -30 },
      { x: 250, y: -30 },
      { x: 250, y: 900 },
      { x: -120.5, y: 900 },
    ]);
  });

  it("resume: a photo re-saved after loading its existing label round-trips through getLabel unchanged, then a correction overwrites cleanly", () => {
    putLabel(labelsDir, "single/photo-001.jpg", validLabel());
    const loaded = getLabel(labelsDir, "single/photo-001.jpg");
    expect(loaded).not.toBeNull();

    // Simulate a human correction: drag one corner, keep everything else.
    const corrected = { ...loaded, quads: [{ ...loaded!.quads[0], corners: [{ x: 11, y: 11 }, { x: 101, y: 10 }, { x: 100, y: 200 }, { x: 10, y: 200 }] }] };
    const result = putLabel(labelsDir, "single/photo-001.jpg", corrected);
    expect(result.ok).toBe(true);

    const reLoaded = getLabel(labelsDir, "single/photo-001.jpg");
    expect(reLoaded!.quads[0].corners[0]).toEqual({ x: 11, y: 11 });
  });
});

// PR #262 review (BLOCKER 1): unauthenticated path traversal — a
// client-supplied `?file=` was passed straight into path.join() with no
// containment check, letting a request read/write ANY file the running
// user can access, not just files under photosDir/labelsDir. Real repro
// confirmed by the reviewer: `file=..%2Foutside-secret.json` on GET
// /api/photo, and a 4-level `../../../../tmp/...` escape on PUT /api/label.
// These tests reproduce the write-side escape at the routes.ts (pure logic)
// level; benchmarkLabel.server.test.ts reproduces both directions over
// real HTTP with the reviewer's exact strings.
describe("path containment (issue #258 security fix, PR #262 review) — never escape labelsDir", () => {
  it("getLabel rejects a relative path that escapes labelsDir, rather than silently reading it", () => {
    // Plant a real file just outside labelsDir to prove nothing is read from it.
    fs.writeFileSync(path.join(tmpDir, "outside-secret.json"), JSON.stringify({ secret: true }));
    expect(() => getLabel(labelsDir, "../outside-secret.jpg")).toThrow(PathEscapeError);
  });

  it("putLabel rejects a relative path that escapes labelsDir, and writes nothing outside", () => {
    const escapedTarget = path.join(tmpDir, "escaped-write.json");
    expect(() => putLabel(labelsDir, "../escaped-write.jpg", validLabel())).toThrow(PathEscapeError);
    expect(fs.existsSync(escapedTarget)).toBe(false);
  });

  it("putLabel rejects a deep multi-level escape (mirrors the reviewer's real ../../../../tmp/... repro)", () => {
    const deepEscape = path.join(tmpDir, "deep-escaped-write.json");
    expect(() =>
      putLabel(labelsDir, "../../../../" + deepEscape.replace(/^\//, "") + ".jpg", validLabel()),
    ).toThrow(PathEscapeError);
    expect(fs.existsSync(deepEscape)).toBe(false);
  });

  it("rejects an absolute path passed as the relative file param", () => {
    expect(() => getLabel(labelsDir, "/etc/passwd")).toThrow(PathEscapeError);
  });

  it("still accepts a normal, well-behaved relative path (no false positives)", () => {
    const result = putLabel(labelsDir, "single/photo-001.jpg", validLabel());
    expect(result.ok).toBe(true);
  });
});

// PR #262 review round 3: path.resolve (used by the containment check above)
// is PURELY LEXICAL — it never touches the filesystem, so it has no idea
// whether a path component is a symlink. But fs.readFileSync/writeFileSync
// (what getLabel/putLabel actually call) DO follow symlinks. So a request
// with NO ".." and NO absolute path at all can still land outside baseDir
// if a real symlink is planted along the way. The reviewer proved this
// live against the running server in both directions. These tests stage
// REAL symlinks with fs.symlinkSync — a string-shaped payload cannot
// exercise this bug at all, so it would be theatre to test it any other
// way.
describe("path containment — symlinks (issue #258 security fix, PR #262 review round 3)", () => {
  it("getLabel does not follow a real symlink planted AT the target path to a file outside labelsDir", () => {
    const outsideSecret = path.join(tmpDir, "outside-secret.json");
    fs.writeFileSync(outsideSecret, JSON.stringify({ secret: true }));

    fs.mkdirSync(path.join(labelsDir, "single"), { recursive: true });
    const linkPath = path.join(labelsDir, "single", "evil-symlink.json");
    fs.symlinkSync(outsideSecret, linkPath);

    expect(() => getLabel(labelsDir, "single/evil-symlink.jpg")).toThrow(PathEscapeError);
  });

  it("putLabel does not follow a real symlinked ANCESTOR DIRECTORY to write outside labelsDir", () => {
    const outsideWriteDir = path.join(tmpDir, "outside-write-target");
    fs.mkdirSync(outsideWriteDir, { recursive: true });

    fs.mkdirSync(labelsDir, { recursive: true });
    const evilDirLink = path.join(labelsDir, "evil");
    fs.symlinkSync(outsideWriteDir, evilDirLink, "dir");

    // No ".." anywhere in this request — it looks like an entirely
    // ordinary label write into a subdirectory of labelsDir.
    expect(() => putLabel(labelsDir, "evil/newfile.jpg", validLabel())).toThrow(PathEscapeError);
    expect(fs.existsSync(path.join(outsideWriteDir, "newfile.json"))).toBe(false);
  });
});

// PR #262 review round 4: fs.realpathSync throws ENOENT both when nothing
// exists at a path AND when a symlink there is DANGLING (its target
// doesn't exist yet) — round 3's fix couldn't tell those apart, so it
// treated a dangling symlink exactly like "nothing here" and climbed past
// it to the (safe) parent directory, silently letting the check pass. The
// three tests below are the reviewer's own boundary map: the middle one is
// the actual gap; the other two prove the fix doesn't touch working
// behavior on either side of it.
describe("path containment — dangling symlinks (issue #258 security fix, PR #262 review round 4)", () => {
  it("control: a symlinked write target whose OUTSIDE destination already exists is still blocked (round 3's fix, unchanged)", () => {
    const outsideExisting = path.join(tmpDir, "outside-existing-target.json");
    fs.writeFileSync(outsideExisting, "{}");
    fs.mkdirSync(path.join(labelsDir, "single"), { recursive: true });
    fs.symlinkSync(outsideExisting, path.join(labelsDir, "single", "x-write-target.json"));

    expect(() => putLabel(labelsDir, "single/x-write-target.jpg", validLabel())).toThrow(PathEscapeError);
  });

  it("THE GAP: a DANGLING symlinked write target (outside destination does not exist yet) must still be blocked", () => {
    const outsideDangling = path.join(tmpDir, "labels-target-outside.json");
    fs.mkdirSync(path.join(labelsDir, "single"), { recursive: true });
    fs.symlinkSync(outsideDangling, path.join(labelsDir, "single", "x-write-target.json")); // target does NOT exist

    expect(fs.existsSync(outsideDangling)).toBe(false); // confirms it's genuinely dangling
    expect(() => putLabel(labelsDir, "single/x-write-target.jpg", validLabel())).toThrow(PathEscapeError);
    expect(fs.existsSync(outsideDangling)).toBe(false); // still not created
  });

  it("control: a DANGLING symlinked ANCESTOR DIRECTORY must be blocked by the check itself, not by mkdirSync happening to fail", () => {
    const outsideDanglingDir = path.join(tmpDir, "outside-dangling-dir");
    fs.mkdirSync(labelsDir, { recursive: true });
    fs.symlinkSync(outsideDanglingDir, path.join(labelsDir, "evil"), "dir"); // target dir does NOT exist

    expect(fs.existsSync(outsideDanglingDir)).toBe(false);
    expect(() => putLabel(labelsDir, "evil/newfile.jpg", validLabel())).toThrow(PathEscapeError);
    expect(fs.existsSync(outsideDanglingDir)).toBe(false);
  });
});
