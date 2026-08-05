import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import sharp from "sharp";
import { decodeAndNormalizeBackground, decodeImageToRaw, encodeRawToJpeg } from "../src/composites/imageIO.js";
import type { RawImage } from "../src/composites/rawImage.js";

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

// #286: decodeImageToRaw (the composites-generation / real-photo-eval decode
// path) silently ignored EXIF orientation — the buffer came out in the
// sensor's raw frame while every human-authored benchmark label was drawn
// against the displayed (EXIF-transposed) frame, so pixels and labels ended
// up 90deg apart for the whole real-photo benchmark set (every photo in it
// carries orientation 6). Canonical frame: displayed/transposed — that is
// the frame every existing label was authored in, so decode must match it,
// not the other way around. Mirrors the exact fixture technique validated
// for decodeAndNormalizeBackground above (PR #246 review round 1):
// withMetadata({orientation}) writes a REAL EXIF Orientation tag, which is
// the only way to catch this class of bug — a fixture built from a raw
// buffer carries no EXIF and would prove nothing (this is precisely why 26
// prior tests missed the defect).
describe("decodeImageToRaw", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-decode-imageio-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("applies EXIF orientation at decode (a 90°-rotation tag swaps physical width/height)", async () => {
    const file = path.join(tmpDir, "exif-rotated.jpg");
    // Distinct corner colors so orientation (not just dimensions) can be
    // verified: red-ish content concentrated in the buffer's top rows.
    const width = 20;
    const height = 10;
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 3;
        // Top-left quadrant of the RAW (un-rotated) buffer is bright red;
        // everything else is dark. After a genuine 90°-CW auto-orient,
        // that red patch must move to the top-right of the displayed frame.
        const isTopLeft = x < width / 2 && y < height / 2;
        raw[i] = isTopLeft ? 250 : 10;
        raw[i + 1] = 10;
        raw[i + 2] = 10;
      }
    }
    await sharp(raw, { raw: { width, height, channels: 3 } })
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 100 })
      .toFile(file);

    // Sanity check: the source really does carry orientation 6 and the
    // un-rotated buffer dims are the ones written above — otherwise this
    // test would prove nothing.
    const rawMeta = await sharp(file).metadata();
    expect(rawMeta.orientation).toBe(6);
    expect(rawMeta.width).toBe(20);
    expect(rawMeta.height).toBe(10);

    const result = await decodeImageToRaw(file);

    // Dimensions must be the TRANSPOSED (displayed) frame, not the raw
    // sensor frame.
    expect(result.width).toBe(10);
    expect(result.height).toBe(20);

    // Content must actually be rotated, not just the dimensions swapped:
    // orientation 6 ("rotate 90° CW to display correctly") moves the raw
    // buffer's top-left quadrant to the displayed frame's top-right.
    const topRight = ((result.width - 1) * 4) as number; // pixel (w-1, 0)
    const topLeft = 0; // pixel (0, 0)
    expect(result.data[topRight]).toBeGreaterThan(200); // red channel, top-right: bright
    expect(result.data[topLeft]).toBeLessThan(50); // red channel, top-left: dark
  });

  it("is a no-op for a source with no EXIF orientation tag (card images / most backgrounds)", async () => {
    const file = path.join(tmpDir, "no-exif.jpg");
    await sharp({ create: { width: 16, height: 8, channels: 3, background: { r: 80, g: 90, b: 100 } } })
      .jpeg({ quality: 100 })
      .toFile(file);

    const rawMeta = await sharp(file).metadata();
    expect(rawMeta.orientation).toBeUndefined();

    const result = await decodeImageToRaw(file);
    expect(result.width).toBe(16);
    expect(result.height).toBe(8);
  });
});

// #268 "Also needed for the real run": a coverage run over the full
// catalog can be thousands of composites — PNG at 1024x1024 is ~2MB each,
// which doesn't fit comfortably alongside the downloaded image cache in
// the available disk budget. JPEG is ~5x smaller and lossless buys nothing
// for training data, so it's a quality-configurable alternative encoder
// (PNG stays the default everywhere else — sample-sheet/QA behavior is
// unchanged).
function solidRaw(width: number, height: number, rgb: [number, number, number]): RawImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

describe("encodeRawToJpeg", () => {
  it("produces real JPEG bytes (magic number) at the requested dimensions", async () => {
    const raw = solidRaw(16, 12, [200, 30, 30]);
    const jpeg = await encodeRawToJpeg(raw, 85);
    expect(jpeg.subarray(0, 2).toString("hex")).toBe("ffd8"); // JPEG SOI marker
    const meta = await sharp(jpeg).metadata();
    expect(meta.width).toBe(16);
    expect(meta.height).toBe(12);
  });

  it("a lower quality setting produces smaller output for the same non-trivial image", async () => {
    // A gradient (not a flat solid color) so JPEG's DCT quantization at
    // different quality levels actually produces a measurable size delta —
    // a flat solid-color image compresses to nearly the same tiny size
    // regardless of quality and would make this test meaningless.
    const width = 64;
    const height = 64;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        data[i] = (x * 4) % 256;
        data[i + 1] = (y * 4) % 256;
        data[i + 2] = ((x + y) * 3) % 256;
        data[i + 3] = 255;
      }
    }
    const raw: RawImage = { width, height, data };
    const high = await encodeRawToJpeg(raw, 95);
    const low = await encodeRawToJpeg(raw, 20);
    expect(low.length).toBeLessThan(high.length);
  });

  it("defaults quality to a sane value when omitted", async () => {
    const raw = solidRaw(8, 8, [1, 2, 3]);
    const jpeg = await encodeRawToJpeg(raw);
    expect(jpeg.subarray(0, 2).toString("hex")).toBe("ffd8");
  });
});
