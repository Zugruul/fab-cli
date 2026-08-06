import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeCompositeRun } from "../src/composites/write.js";
import { buildCompositeManifest } from "../src/composites/manifest.js";
import type { GeneratorConfig } from "../src/composites/config.js";
import type { CompositeLabel } from "../src/composites/types.js";
import type { RawImage } from "../src/composites/rawImage.js";

let tmpDir: string;
let outDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-composites-write-test-"));
  outDir = path.join(tmpDir, "run");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function config(): GeneratorConfig {
  return {
    seed: 1,
    outputSize: { width: 4, height: 4 },
    compositesPerRun: 1,
    cardsPerComposite: { min: 1, max: 1 },
    baseCardHeightFraction: 0.25,
    scale: { min: 1, max: 1 },
    rotationDeg: { min: 0, max: 0 },
    overlapProbability: 0,
    overlapOffsetFraction: { min: 0.1, max: 0.2 },
    perspectiveProbability: 0,
    perspectiveStrength: { min: 0, max: 0.1 },
    glareProbability: 0,
    // #289: blur augmentation knobs are required on GeneratorConfig;
    // probability 0 keeps these fixtures byte-identical to pre-#289.
    blurProbability: 0,
    blurSigma: { min: 0.5, max: 2.5 },
    sleeveProbability: 0,
    lighting: { brightnessDelta: { min: 0, max: 0 }, contrastDelta: { min: 0, max: 0 } },
    backgroundTypes: ["solid"],
    backgroundsDir: null,
    externalBackgroundProbability: 0,
    minVisibleFraction: 0.15,
  };
}

function label(id: string): CompositeLabel {
  return {
    compositeId: id,
    fileName: `${id}.png`,
    width: 4,
    height: 4,
    backgroundType: "procedural:solid",
    backgroundHash: null,
    cards: [],
    excludedCards: 0,
    cardBacksPlaced: 0,
  };
}

function tinyImage(): RawImage {
  return { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4).fill(255) };
}

describe("writeCompositeRun", () => {
  it("writes one PNG + one label.json per composite, plus manifest.json", async () => {
    const labels = [label("composite-0000")];
    const composites = labels.map((l) => ({ label: l, image: tinyImage() }));
    const manifest = buildCompositeManifest({ config: config(), labels });

    await writeCompositeRun(outDir, composites, manifest, async () => Buffer.from("fake-png-bytes"));

    expect(fs.readFileSync(path.join(outDir, "composite-0000.png"))).toEqual(Buffer.from("fake-png-bytes"));
    expect(fs.existsSync(path.join(outDir, "composite-0000.json"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "manifest.json"))).toBe(true);
  });

  it("writes each label.json in the exact byte format the manifest's labelFileHash was computed against", async () => {
    const labels = [label("composite-0000")];
    const composites = labels.map((l) => ({ label: l, image: tinyImage() }));
    const manifest = buildCompositeManifest({ config: config(), labels });

    await writeCompositeRun(outDir, composites, manifest, async () => Buffer.from("x"));

    const onDisk = fs.readFileSync(path.join(outDir, "composite-0000.json"));
    const { sha256 } = await import("../src/benchmark/manifest.js");
    expect(sha256(onDisk)).toBe(manifest.composites[0].labelFileHash);
  });

  it("is atomic: a stale existing outDir is fully replaced, never partially merged", async () => {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "stale-leftover.json"), "{}");

    const labels = [label("composite-0000")];
    const composites = labels.map((l) => ({ label: l, image: tinyImage() }));
    const manifest = buildCompositeManifest({ config: config(), labels });
    await writeCompositeRun(outDir, composites, manifest, async () => Buffer.from("x"));

    expect(fs.existsSync(path.join(outDir, "stale-leftover.json"))).toBe(false);
    expect(fs.existsSync(path.join(outDir, "composite-0000.png"))).toBe(true);
  });

  it("leaves no .tmp-* sibling directories behind after a successful write", async () => {
    const labels = [label("composite-0000")];
    const composites = labels.map((l) => ({ label: l, image: tinyImage() }));
    const manifest = buildCompositeManifest({ config: config(), labels });
    await writeCompositeRun(outDir, composites, manifest, async () => Buffer.from("x"));

    const siblings = fs.readdirSync(path.dirname(outDir));
    expect(siblings.some((s) => s.includes(".tmp-"))).toBe(false);
  });
});
