/**
 * True projective (4-point) homography solve/apply/invert — the pure math
 * warp.ts uses to map a source card image onto an arbitrary destination
 * quad (SPEC-APP.md §8.7b). Deliberately NOT an affine approximation: an
 * affine transform can only ever produce a parallelogram (opposite sides
 * stay parallel), but geometry.ts's perspective insets can produce a
 * genuine trapezoid/asymmetric quad, so the transform used to RENDER a
 * card must be able to represent that too — otherwise the emitted label
 * (a true quad) would not match what was actually painted onto the
 * canvas.
 *
 * Solved via the standard 8-unknown linear system (h33 fixed to 1) from 4
 * point correspondences, using Gaussian elimination with partial
 * pivoting — no external linear-algebra dependency.
 */
import type { Point } from "./types.js";

/** 3x3 matrix, row-major, length 9. */
export type Mat3 = number[];

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length;
  // augmented matrix, worked on as a copy so callers' inputs are untouched
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r;
    }
    if (Math.abs(M[pivotRow][col]) < 1e-12) {
      throw new Error("solveLinearSystem: singular matrix (degenerate/collinear point correspondences)");
    }
    [M[col], M[pivotRow]] = [M[pivotRow], M[col]];

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }

  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Solves the 3x3 homography (up to scale, h[8] fixed to 1) mapping `src`
 * to `dst`, from 4 point correspondences. Throws if the system is
 * (near-)singular — degenerate/collinear points, which shouldn't happen
 * for any well-formed card quad.
 */
export function solveHomography(
  src: [Point, Point, Point, Point],
  dst: [Point, Point, Point, Point],
): Mat3 {
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: X, y: Y } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    b.push(Y);
  }

  const [h0, h1, h2, h3, h4, h5, h6, h7] = solveLinearSystem(A, b);
  return [h0, h1, h2, h3, h4, h5, h6, h7, 1];
}

/** Applies homography `m` to point `p`, dividing through by the
 * homogeneous w component. */
export function applyHomography(m: Mat3, p: Point): Point {
  const w = m[6] * p.x + m[7] * p.y + m[8];
  return {
    x: (m[0] * p.x + m[1] * p.y + m[2]) / w,
    y: (m[3] * p.x + m[4] * p.y + m[5]) / w,
  };
}

/** Standard 3x3 adjugate/determinant matrix inverse. */
export function invertMat3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;

  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error("invertMat3: singular matrix");

  return [A / det, D / det, G / det, B / det, E / det, H / det, C / det, F / det, I / det];
}
