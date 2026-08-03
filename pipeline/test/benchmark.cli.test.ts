import path from "node:path";
import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/benchmark/cli.js";

describe("benchmark cli — parseArgs", () => {
  it("defaults photos/labels/out under pipeline/out/", () => {
    const args = parseArgs([]);
    expect(args.photosDir.endsWith(path.join("pipeline", "out", "benchmark-photos"))).toBe(true);
    expect(args.labelsDir.endsWith(path.join("pipeline", "out", "benchmark-photos", "labels"))).toBe(true);
    expect(args.out.endsWith(path.join("pipeline", "out", "benchmark", "manifest.json"))).toBe(true);
  });

  it("overrides every flag", () => {
    const args = parseArgs(["--photos-dir", "/a", "--labels-dir", "/b", "--out", "/c/manifest.json"]);
    expect(args).toEqual({ photosDir: "/a", labelsDir: "/b", out: "/c/manifest.json" });
  });

  it("ignores a trailing flag with no value rather than crashing", () => {
    const defaults = parseArgs([]);
    const args = parseArgs(["--photos-dir"]);
    expect(args.photosDir).toBe(defaults.photosDir);
  });
});
