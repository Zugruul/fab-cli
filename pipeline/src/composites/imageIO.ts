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
