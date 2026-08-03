/**
 * Inverse-warps a source card image onto an arbitrary destination quad
 * (SPEC-APP.md §8.7b) via homography.ts's true 4-point projective
 * transform + rawImage.ts's bilinear sampling — this is the "pure-TS
 * fallback for perspective" the task brief allows, since sharp/libvips
 * has no general projective (4-point) warp primitive, only affine
 * (rotation/scale/shear, which cannot map a rectangle onto an arbitrary
 * non-parallelogram quad).
 */
import { solveHomography, invertMat3, applyHomography } from "./homography.js";
import { bilinearSample } from "./rawImage.js";
import type { RawImage } from "./rawImage.js";
import type { Point } from "./types.js";

/**
 * Returns a canvasWidth x canvasHeight RGBA image with `source`'s 4 native
 * corners ((0,0),(w,0),(w,h),(0,h)) mapped exactly onto `dstQuad` (same
 * TL,TR,BR,BL order) — everywhere else (outside the quad's bounding box,
 * or that inverse-maps outside the source rect) is fully transparent
 * (alpha=0), so compositeOver can alpha-blend the result straight onto a
 * background with no separate masking step.
 *
 * Iterates only the destination quad's bounding box (clamped to the
 * canvas), not the whole canvas, for performance — training-data
 * generation renders many small cards on a comparatively large canvas.
 */
export function warpToQuad(
  source: RawImage,
  dstQuad: [Point, Point, Point, Point],
  canvasWidth: number,
  canvasHeight: number,
): RawImage {
  const srcRect: [Point, Point, Point, Point] = [
    { x: 0, y: 0 },
    { x: source.width, y: 0 },
    { x: source.width, y: source.height },
    { x: 0, y: source.height },
  ];
  const H = solveHomography(srcRect, dstQuad);
  const Hinv = invertMat3(H);

  const data = new Uint8ClampedArray(canvasWidth * canvasHeight * 4);

  const xs = dstQuad.map((p) => p.x);
  const ys = dstQuad.map((p) => p.y);
  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const maxX = Math.min(canvasWidth - 1, Math.ceil(Math.max(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(canvasHeight - 1, Math.ceil(Math.max(...ys)));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const srcP = applyHomography(Hinv, { x: x + 0.5, y: y + 0.5 });
      const [r, g, b, a] = bilinearSample(source, srcP.x, srcP.y);
      if (a === 0) continue;
      const i = (y * canvasWidth + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }

  return { width: canvasWidth, height: canvasHeight, data };
}
