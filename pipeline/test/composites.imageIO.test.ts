import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import sharp from "sharp";
import { decodeAndNormalizeBackground } from "../src/composites/imageIO.js";

// #244: decodeAndNormalizeBackground is the import-time normalization step
// for user-supplied playmat/background photos — the only new sharp-touching
// function in composites/, per imageIO.ts's "the ONLY module that touches
// sharp" invariant. Real (tiny, synthetic) images via real sharp, same
// style as composites.cli.test.ts's end-to-end real-encode tests.
describe("decodeAndNormalizeBackground", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-bg-imageio-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("decodes a JPEG source to a canonical PNG buffer with matching dimensions (under the cap)", async () => {
    const file = path.join(tmpDir, "photo.jpg");
    await sharp({ create: { width: 12, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } } })
      .jpeg({ quality: 100 })
      .toFile(file);

    const result = await decodeAndNormalizeBackground(file);
    expect(result.width).toBe(12);
    expect(result.height).toBe(8);
    expect(result.png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a"); // PNG magic bytes
  });

  it("decodes a WebP source", async () => {
    const file = path.join(tmpDir, "photo.webp");
    await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } } }).webp().toFile(file);

    const result = await decodeAndNormalizeBackground(file);
    expect(result.width).toBe(10);
    expect(result.height).toBe(10);
  });

  it("decodes a PNG source", async () => {
    const file = path.join(tmpDir, "photo.png");
    await sharp({ create: { width: 6, height: 6, channels: 3, background: { r: 9, g: 9, b: 9 } } }).png().toFile(file);

    const result = await decodeAndNormalizeBackground(file);
    expect(result.width).toBe(6);
    expect(result.height).toBe(6);
  });

  it("downscales a source whose long edge exceeds the cap, preserving aspect ratio (never upscales beyond the cap)", async () => {
    const file = path.join(tmpDir, "wide.png");
    await sharp({ create: { width: 20, height: 10, channels: 3, background: { r: 5, g: 5, b: 5 } } }).png().toFile(file);

    const result = await decodeAndNormalizeBackground(file, 8);
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(8);
    expect(result.width / result.height).toBeCloseTo(2, 1);
  });

  // PR #246 review round 1: lock down the .rotate() auto-orient call with a
  // genuinely EXIF-tagged source, not just an untagged one — sharp's
  // withMetadata({orientation}) writes a real EXIF Orientation tag, and
  // orientation 6 ("rotate 90° CW to display correctly") means the PHYSICAL
  // pixel dimensions the auto-orient step produces are swapped relative to
  // the buffer's own un-rotated width/height.
  it("auto-orients using EXIF orientation metadata (a 90°-rotation tag swaps physical width/height)", async () => {
    const file = path.join(tmpDir, "exif-rotated.jpg");
    await sharp({ create: { width: 20, height: 10, channels: 3, background: { r: 50, g: 60, b: 70 } } })
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 100 })
      .toFile(file);

    // Sanity check: the tagged source really does carry orientation 6 and
    // sharp's own metadata() confirms the un-rotated buffer dimensions —
    // otherwise this test would prove nothing.
    const rawMeta = await sharp(file).metadata();
    expect(rawMeta.orientation).toBe(6);
    expect(rawMeta.width).toBe(20);
    expect(rawMeta.height).toBe(10);

    const result = await decodeAndNormalizeBackground(file);
    expect(result.width).toBe(10);
    expect(result.height).toBe(20);
  });

  it("never upscales a source already under the cap (import-time normalization is downscale-only)", async () => {
    const file = path.join(tmpDir, "small.png");
    await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 9, g: 9, b: 9 } } }).png().toFile(file);

    const result = await decodeAndNormalizeBackground(file, 2048);
    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
  });

  it("throws on a corrupt/non-image file rather than silently producing garbage output", async () => {
    const file = path.join(tmpDir, "corrupt.jpg");
    fs.writeFileSync(file, Buffer.from("not an image, just plain text bytes"));

    await expect(decodeAndNormalizeBackground(file)).rejects.toThrow();
  });

  it("is deterministic — normalizing the same source file twice produces byte-identical PNG output", async () => {
    const file = path.join(tmpDir, "stable.png");
    await sharp({ create: { width: 9, height: 5, channels: 3, background: { r: 40, g: 60, b: 80 } } }).png().toFile(file);

    const a = await decodeAndNormalizeBackground(file);
    const b = await decodeAndNormalizeBackground(file);
    expect(a.png.equals(b.png)).toBe(true);
  });
});
