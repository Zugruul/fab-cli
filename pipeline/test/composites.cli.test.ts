import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import sharp from "sharp";
import {
  parseGenerateArgs,
  parseSampleSheetArgs,
  generateCommand,
  sampleSheetCommand,
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
});
