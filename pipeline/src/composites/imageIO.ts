/**
 * The ONLY module in composites/ that touches sharp (SPEC-APP.md §8.7b).
 * sharp (Apache-2.0, ^0.35.3 — see pipeline/package.json) does affine
 * transforms + alpha compositing, which satisfies the task brief's
 * minimum image-backend bar; it has no general 4-point projective warp,
 * which is why warp.ts implements that in pure TS on top of raw pixel
 * buffers (see warp.ts's header). Isolating sharp to this one thin file
 * keeps decode/encode as the only real-IO/native-binding surface — every
 * other module in this package is pure, seed-testable TypeScript.
 */
import sharp from "sharp";
import type { RawImage } from "./rawImage.js";

/** Decodes any sharp-supported image file to a raw RGBA buffer. */
export async function decodeImageToRaw(filePath: string): Promise<RawImage> {
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

/** Encodes a raw RGBA buffer to PNG bytes. */
export async function encodeRawToPng(img: RawImage): Promise<Buffer> {
  return sharp(Buffer.from(img.data), { raw: { width: img.width, height: img.height, channels: 4 } })
    .png()
    .toBuffer();
}

/** Default JPEG quality (0-100) when a caller doesn't specify one —
 * sharp's own default is 80; 85 is a slightly safer starting point for
 * training composites (a real card's fine print stays legible), still far
 * smaller than lossless PNG. */
const DEFAULT_JPEG_QUALITY = 85;

/**
 * Encodes a raw RGBA buffer to JPEG bytes (#268 "Also needed for the real
 * run" — a coverage run over the full catalog produces thousands of
 * composites; PNG at 1024x1024 is ~2MB each and doesn't comfortably fit
 * alongside the downloaded image cache in the available disk budget. JPEG
 * is ~5x smaller and lossless buys nothing for training data). Alpha is
 * flattened onto opaque white first — JPEG has no alpha channel, and every
 * composite canvas is already fully opaque by the time rendering finishes
 * (background + cards fill the whole frame), so this is a no-op for real
 * output, not a lossy compromise.
 */
export async function encodeRawToJpeg(img: RawImage, quality: number = DEFAULT_JPEG_QUALITY): Promise<Buffer> {
  return sharp(Buffer.from(img.data), { raw: { width: img.width, height: img.height, channels: 4 } })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .jpeg({ quality })
    .toBuffer();
}

export interface NormalizedBackground {
  png: Buffer;
  width: number;
  height: number;
}

/** Default cap for decodeAndNormalizeBackground's long edge — a sane,
 * storage-friendly ceiling for real photos (#244). */
const DEFAULT_MAX_LONG_EDGE = 2048;

/**
 * Decodes any sharp-supported real photo (jpg/jpeg/png/webp) and
 * normalizes it to a canonical PNG for the playmat/background import
 * pipeline (#244, importBackgrounds.ts): auto-orients by EXIF first
 * (phone photos routinely carry an orientation tag), then downscales
 * (NEVER upscales — `withoutEnlargement`) so its longer edge is at most
 * `maxLongEdge`, aspect ratio preserved.
 *
 * This is input NORMALIZATION only, distinct from the separate cover-fit-
 * to-canvas resize that happens at GENERATION time (rawImage.ts's
 * coverFitRawImage, which is allowed to upscale) — this step's job is
 * just capping oversized source photos to a sane ceiling before they're
 * hashed and stored.
 *
 * Throws on any decode failure (corrupt file, unsupported format) — the
 * caller (importBackgrounds.ts) catches this per file so one bad photo
 * never aborts the whole import batch.
 */
export async function decodeAndNormalizeBackground(filePath: string, maxLongEdge = DEFAULT_MAX_LONG_EDGE): Promise<NormalizedBackground> {
  const png = await sharp(filePath)
    .rotate()
    .resize({ width: maxLongEdge, height: maxLongEdge, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  const meta = await sharp(png).metadata();
  return { png, width: meta.width ?? 0, height: meta.height ?? 0 };
}
