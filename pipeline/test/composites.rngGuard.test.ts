import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// APP-026 AC/lesson: "no Math.random anywhere in the generation path" —
// every draw must go through behavior/rng.ts's seeded createRng so a given
// seed reproduces byte-identical output. Enforced statically here rather
// than only behaviorally, so a future change that sneaks in Math.random
// (e.g. inside a new augmentation helper) fails CI immediately instead of
// only showing up as a flaky determinism test.
//
// PR #238 review round 1: a naive `/Math\.random/` check on raw source
// text is trivially evaded (`const r = Math.random; r()`,
// `Math["random"]()`, `(0, Math.random)()`) AND false-positives on doc
// comments that merely MENTION the concept (this module's own headers
// explain why they don't call it). Fixed by (1) stripping comments before
// matching, so prose never trips the check, and (2) matching the bare
// property reference (no required call parens) plus bracket-notation
// access, so aliasing and bracket evasion are both caught. Known
// limitation: a comment-like substring inside a STRING LITERAL would be
// stripped too — an extremely unlikely thing to write and not a real
// evasion vector, so this is accepted rather than reaching for a full TS
// AST parse here.

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

/** Best-effort comment stripper: removes block and line comments so doc
 * comment prose never reaches the forbidden-pattern check below. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Matches Math.random via dot access (with optional chaining/whitespace,
 * and WITHOUT requiring call parens — catches aliasing like
 * `const r = Math.random`) or via bracket-notation property access
 * (`Math["random"]`, `Math['random']`, `Math[\`random\`]`). */
export const FORBIDDEN_RANDOM_PATTERNS: RegExp[] = [
  /Math\s*\??\.\s*random\b/,
  /Math\s*\[\s*["'`]random["'`]\s*\]/,
];

function usesForbiddenRandom(source: string): boolean {
  const stripped = stripComments(source);
  return FORBIDDEN_RANDOM_PATTERNS.some((p) => p.test(stripped));
}

describe("the static Math.random detector itself catches known evasions (self-check)", () => {
  const evasions = [
    "const x = Math.random();",
    "const r = Math.random; r();",
    'Math["random"]();',
    "Math['random']();",
    "Math?.random();",
    "(0, Math.random)();",
    "globalThis.Math.random();",
  ];

  it.each(evasions)("flags: %s", (snippet) => {
    expect(usesForbiddenRandom(snippet)).toBe(true);
  });

  it("does not flag a line comment merely mentioning the concept", () => {
    const snippet = [
      "// This module deliberately does not call Math.random anywhere —",
      "// see behavior/rng.ts's seeded createRng instead.",
      "export const x = 1;",
    ].join("\n");
    expect(usesForbiddenRandom(snippet)).toBe(false);
  });

  it("does not flag a block doc comment mentioning the concept", () => {
    const snippet = ["/**", " * Not Math.random, not stateful.", " */", "export const y = 2;"].join("\n");
    expect(usesForbiddenRandom(snippet)).toBe(false);
  });
});

describe("composites/ source contains no Math.random usage (real files)", () => {
  const files = listTsFiles(SRC_DIR);

  it("finds at least one source file to check (guards against a silently-empty directory)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [path.relative(SRC_DIR, f), f] as const))("%s", (_rel, full) => {
    const content = fs.readFileSync(full, "utf8");
    expect(usesForbiddenRandom(content)).toBe(false);
  });
});
