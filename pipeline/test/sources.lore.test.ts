import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { exportLoreChunks } from "../src/sources/lore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures");

describe("exportLoreChunks", () => {
  it("exports one chunk per lore markdown page, id derived from its path", () => {
    const result = exportLoreChunks(path.join(FIXTURES, "lore"));
    expect(result.chunks).toHaveLength(2);
    const ids = result.chunks.map((c) => c.chunk_id).sort();
    expect(ids).toEqual([
      "lore/archive/world-of-rathe/rathe",
      "lore/other-characters/lord-sutcliffe",
    ]);
  });

  it("carries title and source_url through, and tags archive pages distinctly", () => {
    const result = exportLoreChunks(path.join(FIXTURES, "lore"));
    const sutcliffe = result.chunks.find(
      (c) => c.chunk_id === "lore/other-characters/lord-sutcliffe",
    )!;
    expect(sutcliffe.title).toBe("Lord Sutcliffe");
    expect(sutcliffe.source).toBe(
      "https://legendarystories.net/other-characters/lord-sutcliffe.html",
    );
    expect(sutcliffe.tags).not.toContain("archive");

    const rathe = result.chunks.find(
      (c) => c.chunk_id === "lore/archive/world-of-rathe/rathe",
    )!;
    expect(rathe.tags).toContain("archive");
  });
});
