import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// APP-026 AC/lesson: "no Math.random anywhere in the generation path" —
// every draw must go through behavior/rng.ts's seeded createRng so a given
// seed reproduces byte-identical output. Enforced statically here rather
// than only behaviorally, so a future change that sneaks in Math.random
// (e.g. inside a new augmentation helper) fails CI immediately instead of
// only showing up as a flaky determinism test.

const SRC_DIR = path.join(import.meta.dirname, "..", "src", "composites");

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("composites/ source contains no Math.random calls", () => {
  const files = listTsFiles(SRC_DIR);

  it("finds at least one source file to check (guards against a silently-empty directory)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [path.relative(SRC_DIR, f), f] as const))("%s", (_rel, full) => {
    const content = fs.readFileSync(full, "utf8");
    // Matches an actual call (the open paren) rather than bare "Math.random"
    // text, so doc comments that just mention the concept (e.g. this
    // module's own headers explaining why they DON'T use it) don't
    // false-positive.
    expect(content).not.toMatch(/Math\.random\s*\(/);
  });
});
