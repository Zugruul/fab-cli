import path from "node:path";
import { describe, it, expect } from "vitest";
import { defaultArgs, parseArgs } from "../src/benchmark-label/cli.js";

describe("benchmark-label cli — defaultArgs", () => {
  it("points at the same default dirs as benchmark/cli.ts and images/cli.ts", () => {
    const args = defaultArgs("/repo");
    expect(args.config.photosDir).toBe(path.join("/repo", "pipeline", "out", "benchmark-photos"));
    expect(args.config.labelsDir).toBe(path.join("/repo", "pipeline", "out", "benchmark-photos", "labels"));
    expect(args.config.cardJsonPath).toBe(
      path.join("/repo", "fab-cli", "third_party", "flesh-and-blood-cards", "json", "english", "card.json"),
    );
    expect(args.config.imagesCacheDir).toBe(path.join("/repo", "pipeline", "out", "images"));
    expect(args.port).toBe(4173);
  });
});

describe("benchmark-label cli — parseArgs", () => {
  it("returns the defaults unchanged when no flags are passed", () => {
    const defaults = defaultArgs("/repo");
    expect(parseArgs([], defaults)).toEqual(defaults);
  });

  it("overrides every flag", () => {
    const args = parseArgs(
      ["--photos-dir", "/a", "--labels-dir", "/b", "--card-json", "/c.json", "--images-cache-dir", "/d", "--port", "9999"],
      defaultArgs("/repo"),
    );
    expect(args.config).toEqual({ photosDir: "/a", labelsDir: "/b", cardJsonPath: "/c.json", imagesCacheDir: "/d" });
    expect(args.port).toBe(9999);
  });

  it("does not mutate the defaults object passed in", () => {
    const defaults = defaultArgs("/repo");
    parseArgs(["--port", "1"], defaults);
    expect(defaults.port).toBe(4173);
  });
});
