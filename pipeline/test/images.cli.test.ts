import path from "node:path";
import { describe, it, expect } from "vitest";
import { parseArgs, defaultArgs } from "../src/images/cli.js";

describe("images cli — defaultArgs", () => {
  it("points at the vendored card.json under fab-cli/third_party, and pipeline/out/images as the cache dir", () => {
    const args = defaultArgs("/repo");
    expect(args.cardJsonPath).toBe(
      path.join("/repo", "fab-cli", "third_party", "flesh-and-blood-cards", "json", "english", "card.json"),
    );
    expect(args.options.cacheDir).toBe(path.join("/repo", "pipeline", "out", "images"));
    expect(args.limit).toBeNull();
  });

  it("uses conservative defaults (2 rps / 2 concurrent)", () => {
    const args = defaultArgs("/repo");
    expect(args.options.requestsPerSecond).toBe(2);
    expect(args.options.concurrency).toBe(2);
  });
});

describe("images cli — parseArgs", () => {
  it("returns the defaults unchanged when no flags are passed", () => {
    const defaults = defaultArgs("/repo");
    expect(parseArgs([], defaults)).toEqual(defaults);
  });

  it("overrides limit, rps, concurrency, and out via flags", () => {
    const args = parseArgs(
      ["--limit", "10", "--rps", "5", "--concurrency", "3", "--out", "/tmp/cache"],
      defaultArgs("/repo"),
    );
    expect(args.limit).toBe(10);
    expect(args.options.requestsPerSecond).toBe(5);
    expect(args.options.concurrency).toBe(3);
    expect(args.options.cacheDir).toBe("/tmp/cache");
  });

  it("does not mutate the defaults object passed in", () => {
    const defaults = defaultArgs("/repo");
    parseArgs(["--limit", "10"], defaults);
    expect(defaults.limit).toBeNull();
  });
});
