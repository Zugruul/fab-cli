import { describe, it, expect } from "vitest";
import { importBackgrounds } from "../src/composites/importBackgrounds.js";
import type { ImportBackgroundsIO } from "../src/composites/importBackgrounds.js";

// #244: the playmat/background photo importer's pure core, tested with
// fully injected IO (no real fs/sharp — see composites.imageIO.test.ts and
// composites.cli.test.ts for the real-sharp end-to-end coverage). These
// bytes are NOT valid PNGs — importBackgrounds never parses image content
// itself, it only hashes+writes whatever normalizeImage hands back.
function fakePng(byte: number): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, byte]);
}

describe("importBackgrounds", () => {
  it("imports every recognized-extension file, writing <hash16>.png to outDir", async () => {
    const written = new Map<string, Buffer>();
    const io: ImportBackgroundsIO = {
      listDir: () => ["a.jpg", "b.webp"],
      ensureDir: () => {},
      writeFile: (p, data) => written.set(p, data),
      normalizeImage: async (filePath) => ({ png: fakePng(filePath.endsWith("a.jpg") ? 1 : 2), width: 100, height: 50 }),
    };
    const result = await importBackgrounds("/src", "/out", io);

    expect(result.imported).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
    for (const entry of result.imported) {
      expect(entry.outputFileName).toBe(`${entry.contentHash}.png`);
      expect(entry.contentHash).toMatch(/^[0-9a-f]{16}$/);
      expect(written.has(`/out/${entry.outputFileName}`)).toBe(true);
    }
    expect(new Set(result.imported.map((e) => e.outputFileName)).size).toBe(2);
  });

  it("skips a file with an unrecognized extension, loudly, without touching normalizeImage or writeFile", async () => {
    let normalizeCalled = false;
    const io: ImportBackgroundsIO = {
      listDir: () => ["notes.txt"],
      ensureDir: () => {},
      writeFile: () => {
        throw new Error("should not write");
      },
      normalizeImage: async () => {
        normalizeCalled = true;
        return { png: fakePng(1), width: 1, height: 1 };
      },
    };
    const result = await importBackgrounds("/src", "/out", io);

    expect(result.imported).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].sourceFile).toBe("notes.txt");
    expect(result.skipped[0].reason).toMatch(/extension/);
    expect(normalizeCalled).toBe(false);
  });

  it("skips a corrupt/undecodable image loudly, without crashing the rest of the batch", async () => {
    const io: ImportBackgroundsIO = {
      listDir: () => ["good.jpg", "corrupt.jpg"],
      ensureDir: () => {},
      writeFile: () => {},
      normalizeImage: async (filePath) => {
        if (filePath.endsWith("corrupt.jpg")) throw new Error("unsupported image format");
        return { png: fakePng(1), width: 10, height: 10 };
      },
    };
    const result = await importBackgrounds("/src", "/out", io);

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].sourceFile).toBe("good.jpg");
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].sourceFile).toBe("corrupt.jpg");
    expect(result.skipped[0].reason).toMatch(/unsupported image format/);
  });

  // Lesson (dev brain, #244 brief item 6): content-hash filenames make
  // collisions structurally impossible for DIFFERENT content — prove the
  // dedupe side of that here (same content -> same name, by construction).
  it("DEDUPE: two different source files that normalize to identical bytes collapse to ONE output file", async () => {
    const written = new Map<string, Buffer>();
    const identical = fakePng(42);
    const io: ImportBackgroundsIO = {
      listDir: () => ["photo-v1.jpg", "photo-v2-reexported.webp"],
      ensureDir: () => {},
      writeFile: (p, data) => written.set(p, data),
      normalizeImage: async () => ({ png: identical, width: 10, height: 10 }),
    };
    const result = await importBackgrounds("/src", "/out", io);

    expect(result.imported).toHaveLength(2);
    const outputNames = new Set(result.imported.map((e) => e.outputFileName));
    expect(outputNames.size).toBe(1);
    expect(written.size).toBe(1);

    const first = result.imported.find((e) => e.sourceFile === "photo-v1.jpg")!;
    const second = result.imported.find((e) => e.sourceFile === "photo-v2-reexported.webp")!;
    expect(first.dedupedAgainst).toBeNull();
    expect(second.dedupedAgainst).toBe("photo-v1.jpg");
  });

  // The other half of the same lesson: prove two DIFFERENT contents can
  // never collide at one name (a real hash collision is not a real-world
  // concern at this corpus size — a matching name is proof of matching
  // content, by construction).
  it("NO-COLLISION: two DIFFERENT contents always land at two DIFFERENT names, each with its own correct bytes", async () => {
    const written = new Map<string, Buffer>();
    const io: ImportBackgroundsIO = {
      listDir: () => ["a.jpg", "b.jpg"],
      ensureDir: () => {},
      writeFile: (p, data) => written.set(p, data),
      normalizeImage: async (filePath) => ({ png: fakePng(filePath.endsWith("a.jpg") ? 7 : 9), width: 10, height: 10 }),
    };
    const result = await importBackgrounds("/src", "/out", io);

    const names = result.imported.map((e) => e.outputFileName);
    expect(new Set(names).size).toBe(2);
    expect(written.size).toBe(2);
    const a = result.imported.find((e) => e.sourceFile === "a.jpg")!;
    const b = result.imported.find((e) => e.sourceFile === "b.jpg")!;
    expect(written.get(`/out/${a.outputFileName}`)).toEqual(fakePng(7));
    expect(written.get(`/out/${b.outputFileName}`)).toEqual(fakePng(9));
  });

  it("processes source files in a stable, sorted order (deterministic dedupe 'first seen' attribution)", async () => {
    const seen: string[] = [];
    const io: ImportBackgroundsIO = {
      listDir: () => ["zzz.jpg", "aaa.jpg", "mmm.jpg"],
      ensureDir: () => {},
      writeFile: () => {},
      normalizeImage: async (filePath) => {
        const name = filePath.split("/").pop()!;
        seen.push(name);
        return { png: fakePng(seen.length), width: 1, height: 1 };
      },
    };
    await importBackgrounds("/src", "/out", io);
    expect(seen).toEqual(["aaa.jpg", "mmm.jpg", "zzz.jpg"]);
  });

  it("calls ensureDir(outDir) before writing any file", async () => {
    let ensured = false;
    const io: ImportBackgroundsIO = {
      listDir: () => ["a.jpg"],
      ensureDir: (dir) => {
        expect(dir).toBe("/out");
        ensured = true;
      },
      writeFile: () => {
        expect(ensured).toBe(true);
      },
      normalizeImage: async () => ({ png: fakePng(1), width: 1, height: 1 }),
    };
    await importBackgrounds("/src", "/out", io);
    expect(ensured).toBe(true);
  });

  it("returns an empty result (no imports, no skips) for an empty source directory", async () => {
    const io: ImportBackgroundsIO = {
      listDir: () => [],
      ensureDir: () => {},
      writeFile: () => {},
      normalizeImage: async () => ({ png: fakePng(1), width: 1, height: 1 }),
    };
    const result = await importBackgrounds("/src", "/out", io);
    expect(result.imported).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });
});
