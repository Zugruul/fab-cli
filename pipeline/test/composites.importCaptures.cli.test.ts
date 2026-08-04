import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import sharp from "sharp";
import { parseImportCapturesArgs, importCapturesCommand } from "../src/composites/cli.js";

// #256: `composites import-captures` CLI wiring — mirrors
// `import-backgrounds`'s parse-args + real-sharp-end-to-end test structure
// (composites.cli.test.ts) exactly, since import-captures reuses that
// command's exact IO discipline underneath (importCaptures.ts).

describe("parseImportCapturesArgs", () => {
  it("requires --source", () => {
    expect(() => parseImportCapturesArgs([])).toThrow(/--source/);
  });

  it("defaults --out under pipeline/out/backgrounds/captures (NEVER the playmats dir generate's --backgrounds-dir reads)", () => {
    const args = parseImportCapturesArgs(["--source", "/tmp/src"]);
    expect(args.sourceDir).toBe("/tmp/src");
    expect(args.outDir.split(path.sep).slice(-3)).toEqual(["out", "backgrounds", "captures"]);
    expect(args.outDir).not.toMatch(/playmats/);
  });

  it("accepts a --out override", () => {
    const args = parseImportCapturesArgs(["--source", "/tmp/src", "--out", "/tmp/out"]);
    expect(args.outDir).toBe("/tmp/out");
  });

  it("defaults --config under pipeline/config/broadcast-import.json", () => {
    const args = parseImportCapturesArgs(["--source", "/tmp/src"]);
    expect(args.configPath.split(path.sep).slice(-2)).toEqual(["config", "broadcast-import.json"]);
  });
});

describe("importCapturesCommand — real end-to-end (real sharp encode/decode)", () => {
  let srcDir: string;
  let outDir: string;

  beforeEach(() => {
    srcDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-captures-import-src-"));
    outDir = path.join(os.tmpdir(), `fab-captures-import-out-${process.pid}-${Date.now()}`);
  });

  afterEach(() => {
    fs.rmSync(srcDir, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it("imports a wide frame as full-broadcast and a narrow frame as play-area-crop, writing a manifest with both", async () => {
    // Real aspect ratios from the tournament-caps corpus (see
    // config/broadcast-import.json's doc string), scaled down for a fast test.
    await sharp({ create: { width: 218, height: 123, channels: 3, background: { r: 40, g: 40, b: 60 } } }) // ~1.77
      .png()
      .toFile(path.join(srcDir, "full-frame.png"));
    await sharp({ create: { width: 137, height: 115, channels: 3, background: { r: 200, g: 200, b: 200 } } }) // ~1.19
      .png()
      .toFile(path.join(srcDir, "crop-frame.png"));

    const code = await importCapturesCommand(["--source", srcDir, "--out", outDir]);
    expect(code).toBe(0);

    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8"));
    expect(manifest.imported).toHaveLength(2);
    const framings = manifest.imported.map((c: { framing: string }) => c.framing).sort();
    expect(framings).toEqual(["full-broadcast", "play-area-crop"]);

    // Actual PNG files are written under content-hash names too.
    const pngFiles = fs.readdirSync(outDir).filter((f) => f.endsWith(".png"));
    expect(pngFiles).toHaveLength(2);
    for (const f of pngFiles) expect(f).toMatch(/^[0-9a-f]{16}\.png$/);
  });

  it("is idempotent — importing the same source dir twice produces the same manifest content", async () => {
    await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 5, g: 5, b: 5 } } }).png().toFile(path.join(srcDir, "sq.png"));

    await importCapturesCommand(["--source", srcDir, "--out", outDir]);
    const first = fs.readFileSync(path.join(outDir, "manifest.json"), "utf8");
    await importCapturesCommand(["--source", srcDir, "--out", outDir]);
    const second = fs.readFileSync(path.join(outDir, "manifest.json"), "utf8");

    expect(second).toBe(first);
  });
});
