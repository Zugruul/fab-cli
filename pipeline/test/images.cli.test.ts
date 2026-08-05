import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

  it("defaults downloadFailuresPath to a sibling of the cache dir (out/download-failures.json)", () => {
    const args = defaultArgs("/repo");
    expect(args.downloadFailuresPath).toBe(path.join("/repo", "pipeline", "out", "download-failures.json"));
  });

  it("accepts a --download-failures override", () => {
    const args = parseArgs(["--download-failures", "/tmp/failures.json"], defaultArgs("/repo"));
    expect(args.downloadFailuresPath).toBe("/tmp/failures.json");
  });
});

// #268: a coverage-mode composites run over the full catalog needs to know
// WHICH printings permanently failed to download (and why — HTTP status),
// so it can exclude them from the eligible pool and report them as
// "unavailable upstream" rather than either aborting the whole run
// (assertDownloadsSucceeded's correct-for-small-runs behavior) or silently
// treating a missing cache file as an ordinary coverage shortfall.
describe("downloadCommand — persists a download-failures manifest", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-images-cli-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes an empty array when every download succeeds", async () => {
    const { downloadCommand } = await import("../src/images/cli.js");
    const cardJsonPath = path.join(tmpDir, "card.json");
    fs.writeFileSync(
      cardJsonPath,
      JSON.stringify([{ name: "Card A", printings: [{ unique_id: "p1", id: "A1", set_id: "SET", image_url: "https://example.com/p1.webp" }] }]),
    );
    const failuresPath = path.join(tmpDir, "download-failures.json");

    await downloadCommand(
      ["--card-json", cardJsonPath, "--out", path.join(tmpDir, "images"), "--download-failures", failuresPath],
      {
        fetchFn: async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) }),
      },
    );

    const failures = JSON.parse(fs.readFileSync(failuresPath, "utf8"));
    expect(failures).toEqual([]);
  });

  it("writes the failed printings with parsed HTTP status when some downloads permanently fail — never aborts the run", async () => {
    const { downloadCommand } = await import("../src/images/cli.js");
    const cardJsonPath = path.join(tmpDir, "card.json");
    fs.writeFileSync(
      cardJsonPath,
      JSON.stringify([
        { name: "Card A", printings: [{ unique_id: "p1", id: "A1", set_id: "SET", image_url: "https://example.com/p1.webp" }] },
        { name: "Card B", printings: [{ unique_id: "p2", id: "B1", set_id: "SET", image_url: "https://example.com/p2.webp" }] },
      ]),
    );
    const failuresPath = path.join(tmpDir, "download-failures.json");

    await downloadCommand(
      ["--card-json", cardJsonPath, "--out", path.join(tmpDir, "images"), "--download-failures", failuresPath],
      {
        fetchFn: async (url: string) =>
          url.includes("p2") ? { ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0) } : { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) },
        maxRetries: 0,
      },
    );

    const failures = JSON.parse(fs.readFileSync(failuresPath, "utf8"));
    expect(failures).toEqual([{ printingId: "p2", httpStatus: 403, reason: expect.stringContaining("403") }]);
    // The successful printing was still downloaded — one bad printing never
    // aborts the others (downloadAll's existing, unchanged contract).
    expect(fs.existsSync(path.join(tmpDir, "images", "p1.webp"))).toBe(true);
  });
});
