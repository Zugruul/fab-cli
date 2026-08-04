import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import sharp from "sharp";
import {
  parseGenerateArgs,
  parseSampleSheetArgs,
  parseImportBackgroundsArgs,
  generateCommand,
  sampleSheetCommand,
  importBackgroundsCommand,
} from "../src/composites/cli.js";

describe("parseGenerateArgs", () => {
  it("defaults configPath under pipeline/config/composites-generation.json", () => {
    const args = parseGenerateArgs([]);
    expect(args.configPath.split(path.sep).slice(-2)).toEqual(["config", "composites-generation.json"]);
  });

  it("accepts --config, --card-json, --images-cache-dir, --out, --seed overrides", () => {
    const args = parseGenerateArgs([
      "--config", "/tmp/config.json",
      "--card-json", "/tmp/card.json",
      "--images-cache-dir", "/tmp/images",
      "--out", "/tmp/out",
      "--seed", "42",
    ]);
    expect(args.configPath).toBe("/tmp/config.json");
    expect(args.cardJsonPath).toBe("/tmp/card.json");
    expect(args.imagesCacheDir).toBe("/tmp/images");
    expect(args.outDir).toBe("/tmp/out");
    expect(args.seed).toBe(42);
  });

  it("defaults seed to null (no silent override)", () => {
    expect(parseGenerateArgs([]).seed).toBeNull();
  });

  // #244: CLI overrides for the external-backgrounds config knobs, mirroring
  // --seed's "explicit override, no silent default" pattern.
  it("accepts --backgrounds-dir and --external-background-probability overrides", () => {
    const args = parseGenerateArgs(["--backgrounds-dir", "/tmp/bg", "--external-background-probability", "0.7"]);
    expect(args.backgroundsDir).toBe("/tmp/bg");
    expect(args.externalBackgroundProbability).toBe(0.7);
  });

  it("defaults backgroundsDir/externalBackgroundProbability to 'no CLI override' (config file value stands)", () => {
    const args = parseGenerateArgs([]);
    expect(args.backgroundsDir).toBeUndefined();
    expect(args.externalBackgroundProbability).toBeNull();
  });
});

describe("parseImportBackgroundsArgs", () => {
  it("requires --source", () => {
    expect(() => parseImportBackgroundsArgs([])).toThrow(/--source/);
  });

  it("defaults --out under pipeline/out/backgrounds/playmats", () => {
    const args = parseImportBackgroundsArgs(["--source", "/tmp/src"]);
    expect(args.sourceDir).toBe("/tmp/src");
    expect(args.outDir.split(path.sep).slice(-3)).toEqual(["out", "backgrounds", "playmats"]);
  });

  it("accepts a --out override", () => {
    const args = parseImportBackgroundsArgs(["--source", "/tmp/src", "--out", "/tmp/out"]);
    expect(args.outDir).toBe("/tmp/out");
  });
});

describe("parseSampleSheetArgs", () => {
  it("defaults --out to <run-dir>/sample-sheet.html", () => {
    const args = parseSampleSheetArgs(["--run-dir", "/tmp/run"]);
    expect(args.out).toBe(path.join("/tmp/run", "sample-sheet.html"));
  });

  it("accepts --run-dir, --out, --title overrides", () => {
    const args = parseSampleSheetArgs(["--run-dir", "/tmp/run", "--out", "/tmp/sheet.html", "--title", "My title"]);
    expect(args.runDir).toBe("/tmp/run");
    expect(args.out).toBe("/tmp/sheet.html");
    expect(args.title).toBe("My title");
  });
});

describe("generateCommand + sampleSheetCommand — real end-to-end (tiny synthetic images, real sharp encode/decode)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-composites-cli-test-"));
    fs.mkdirSync(path.join(tmpDir, "images"), { recursive: true });

    // two tiny, clearly-synthetic card images (solid color rectangles)
    await sharp({ create: { width: 20, height: 30, channels: 3, background: { r: 200, g: 30, b: 30 } } })
      .png()
      .toFile(path.join(tmpDir, "images", "printing-a.png"));
    await sharp({ create: { width: 20, height: 30, channels: 3, background: { r: 30, g: 30, b: 200 } } })
      .png()
      .toFile(path.join(tmpDir, "images", "printing-b.png"));

    fs.writeFileSync(
      path.join(tmpDir, "card.json"),
      JSON.stringify([
        { name: "Card A", printings: [{ unique_id: "printing-a", id: "A001", set_id: "SET", image_url: "https://example.com/printing-a.png" }] },
        { name: "Card B", printings: [{ unique_id: "printing-b", id: "B001", set_id: "SET", image_url: "https://example.com/printing-b.png" }] },
      ]),
    );

    fs.writeFileSync(
      path.join(tmpDir, "config.json"),
      JSON.stringify({
        seed: 7,
        outputSize: { width: 48, height: 48 },
        compositesPerRun: 2,
        cardsPerComposite: { min: 1, max: 2 },
        baseCardHeightFraction: 0.3,
        scale: { min: 0.9, max: 1.1 },
        rotationDeg: { min: -10, max: 10 },
        overlapProbability: 0.2,
        overlapOffsetFraction: { min: 0.1, max: 0.2 },
        perspectiveProbability: 0.2,
        perspectiveStrength: { min: 0, max: 0.15 },
        glareProbability: 0.2,
        sleeveProbability: 0.2,
        lighting: { brightnessDelta: { min: -0.05, max: 0.05 }, contrastDelta: { min: -0.05, max: 0.05 } },
        backgroundTypes: ["solid", "gradient", "noise", "texture"],
        backgroundsDir: null,
        externalBackgroundProbability: 0,
      }),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates composites + manifest, then a sample sheet referencing them", async () => {
    const outDir = path.join(tmpDir, "out");
    const exitCode = await generateCommand([
      "--config", path.join(tmpDir, "config.json"),
      "--card-json", path.join(tmpDir, "card.json"),
      "--images-cache-dir", path.join(tmpDir, "images"),
      "--out", outDir,
    ]);
    expect(exitCode).toBe(0);

    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8"));
    expect(manifest.compositeCount).toBe(2);
    for (const entry of manifest.composites) {
      expect(fs.existsSync(path.join(outDir, entry.fileName))).toBe(true);
      expect(fs.existsSync(path.join(outDir, `${entry.compositeId}.json`))).toBe(true);
    }

    const sheetPath = path.join(tmpDir, "sample-sheet.html");
    sampleSheetCommand(["--run-dir", outDir, "--out", sheetPath]);
    const html = fs.readFileSync(sheetPath, "utf8");
    expect(html).toContain(manifest.composites[0].fileName);
  });

  it("re-running generate with the same config + seed produces byte-identical label files", async () => {
    const outDirA = path.join(tmpDir, "out-a");
    const outDirB = path.join(tmpDir, "out-b");
    const commonArgs = [
      "--config", path.join(tmpDir, "config.json"),
      "--card-json", path.join(tmpDir, "card.json"),
      "--images-cache-dir", path.join(tmpDir, "images"),
    ];
    await generateCommand([...commonArgs, "--out", outDirA]);
    await generateCommand([...commonArgs, "--out", outDirB]);

    const manifestA = JSON.parse(fs.readFileSync(path.join(outDirA, "manifest.json"), "utf8"));
    const manifestB = JSON.parse(fs.readFileSync(path.join(outDirB, "manifest.json"), "utf8"));
    expect(manifestA.composites.map((c: { labelFileHash: string }) => c.labelFileHash)).toEqual(
      manifestB.composites.map((c: { labelFileHash: string }) => c.labelFileHash),
    );
  });

  // #244: --backgrounds-dir / --external-background-probability wiring.
  it("uses external backgrounds end to end when --backgrounds-dir + a high probability are configured", async () => {
    const bgDir = path.join(tmpDir, "backgrounds");
    fs.mkdirSync(bgDir, { recursive: true });
    await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 5, g: 5, b: 200 } } }).png().toFile(path.join(bgDir, "bg1.png"));

    const outDir = path.join(tmpDir, "out-bg");
    const exitCode = await generateCommand([
      "--config", path.join(tmpDir, "config.json"),
      "--card-json", path.join(tmpDir, "card.json"),
      "--images-cache-dir", path.join(tmpDir, "images"),
      "--out", outDir,
      "--backgrounds-dir", bgDir,
      "--external-background-probability", "1",
    ]);
    expect(exitCode).toBe(0);

    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8"));
    expect(manifest.compositeCount).toBeGreaterThan(0);
    for (const entry of manifest.composites) {
      const label = JSON.parse(fs.readFileSync(path.join(outDir, `${entry.compositeId}.json`), "utf8"));
      expect(label.backgroundType).toBe("external");
      expect(label.backgroundHash).not.toBeNull();
    }
  });

  it("fails loudly when --backgrounds-dir is set but contains no usable images (the user explicitly configured it — no silent procedural fallback)", async () => {
    const emptyBgDir = path.join(tmpDir, "empty-backgrounds");
    fs.mkdirSync(emptyBgDir, { recursive: true });

    await expect(
      generateCommand([
        "--config", path.join(tmpDir, "config.json"),
        "--card-json", path.join(tmpDir, "card.json"),
        "--images-cache-dir", path.join(tmpDir, "images"),
        "--out", path.join(tmpDir, "out-empty-bg"),
        "--backgrounds-dir", emptyBgDir,
      ]),
    ).rejects.toThrow(/backgroundsDir/);
  });

  it("fails loudly when --backgrounds-dir points at a nonexistent directory", async () => {
    await expect(
      generateCommand([
        "--config", path.join(tmpDir, "config.json"),
        "--card-json", path.join(tmpDir, "card.json"),
        "--images-cache-dir", path.join(tmpDir, "images"),
        "--out", path.join(tmpDir, "out-missing-bg"),
        "--backgrounds-dir", path.join(tmpDir, "does-not-exist"),
      ]),
    ).rejects.toThrow(/backgroundsDir/);
  });
});

describe("importBackgroundsCommand — real end-to-end (real sharp encode/decode)", () => {
  let srcDir: string;
  let outDir: string;

  beforeEach(() => {
    srcDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-bg-import-src-"));
    outDir = path.join(os.tmpdir(), `fab-bg-import-out-${process.pid}-${Date.now()}`);
  });

  afterEach(() => {
    fs.rmSync(srcDir, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it("imports jpg + webp real photos, dedupes an exact re-saved duplicate, and skips a non-image file", async () => {
    await sharp({ create: { width: 30, height: 20, channels: 3, background: { r: 200, g: 30, b: 30 } } })
      .jpeg({ quality: 100 })
      .toFile(path.join(srcDir, "mat-a.jpg"));
    await sharp({ create: { width: 15, height: 40, channels: 3, background: { r: 10, g: 200, b: 10 } } })
      .webp()
      .toFile(path.join(srcDir, "mat-b.webp"));
    // Exact byte-for-byte duplicate under a different name — guaranteed
    // identical decode, so dedupe is proven without any cross-codec
    // round-trip risk (see composites.importBackgrounds.test.ts for the
    // pure-hash-logic dedupe tests).
    fs.copyFileSync(path.join(srcDir, "mat-a.jpg"), path.join(srcDir, "mat-a-copy.jpg"));
    fs.writeFileSync(path.join(srcDir, "readme.txt"), "not an image");

    const code = await importBackgroundsCommand(["--source", srcDir, "--out", outDir]);
    expect(code).toBe(0);

    const files = fs.readdirSync(outDir);
    expect(files).toHaveLength(2); // mat-a (+ its exact copy, deduped) and mat-b
    for (const f of files) expect(f).toMatch(/^[0-9a-f]{16}\.png$/);
  });

  it("does not crash on a corrupt image file — skips it and still imports the good one", async () => {
    await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 1, b: 1 } } }).png().toFile(path.join(srcDir, "good.png"));
    fs.writeFileSync(path.join(srcDir, "corrupt.jpg"), Buffer.from("garbage bytes, not a real jpeg"));

    const code = await importBackgroundsCommand(["--source", srcDir, "--out", outDir]);
    expect(code).toBe(0);
    expect(fs.readdirSync(outDir)).toHaveLength(1);
  });

  it("is idempotent — importing the same source dir twice produces the same set of output files", async () => {
    await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 3, g: 3, b: 3 } } }).png().toFile(path.join(srcDir, "mat.png"));

    await importBackgroundsCommand(["--source", srcDir, "--out", outDir]);
    const first = fs.readdirSync(outDir).sort();
    await importBackgroundsCommand(["--source", srcDir, "--out", outDir]);
    const second = fs.readdirSync(outDir).sort();

    expect(second).toEqual(first);
  });
});
