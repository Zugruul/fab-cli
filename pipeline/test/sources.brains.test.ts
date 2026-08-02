import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { exportBrainNotes } from "../src/sources/brains.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures");
const IDENTITIES_ROOT = path.join(FIXTURES, "identities");

describe("exportBrainNotes", () => {
  it("exports one chunk per physical note and dedupes symlinked notes to their owning identity", () => {
    const result = exportBrainNotes(IDENTITIES_ROOT, ["judge", "player", "card-vault"]);

    // 5 physical notes total: card-vault has kw-dominate.md + card-heartstoker-branchblade.md +
    // kw-chained.md, judge has ruling-dominate-timing.md (+ symlinks: kw-dominate.md,
    // kw-chained.md, and a broken kw-ghost.md), player has strategy-blocking-basics.md (+
    // symlinks: kw-dominate.md, and kw-chained.md — itself a symlink to judge's symlink). Every
    // symlink must dedupe to its single owning-identity chunk; the broken symlink is skipped
    // entirely (see the dedicated "skips a broken symlink" test).
    expect(result.chunks).toHaveLength(5);

    const ids = result.chunks.map((c) => c.chunk_id).sort();
    expect(ids).toEqual([
      "brain/card-vault/card-heartstoker-branchblade",
      "brain/card-vault/kw-chained",
      "brain/card-vault/kw-dominate",
      "brain/judge/ruling-dominate-timing",
      "brain/player/strategy-blocking-basics",
    ]);

    // the symlinked notes are owned by card-vault, not judge or player
    expect(result.countsByIdentity["judge"]).toBe(1);
    expect(result.countsByIdentity["player"]).toBe(1);
    expect(result.countsByIdentity["card-vault"]).toBe(3);
  });

  it("extracts frontmatter tags, source, and body text for a note", () => {
    const result = exportBrainNotes(IDENTITIES_ROOT, ["judge", "player", "card-vault"]);
    const dominate = result.chunks.find((c) => c.chunk_id === "brain/card-vault/kw-dominate")!;
    expect(dominate.tags).toEqual(["cr", "keyword", "ability", "dominate"]);
    expect(dominate.source).toContain("CR 8.3.1");
    expect(dominate.text).toContain("Dominate");
    expect(dominate.text).not.toMatch(/^---/);
  });

  it("extracts [[slug]] wikilinks as links[]", () => {
    const result = exportBrainNotes(IDENTITIES_ROOT, ["judge", "player", "card-vault"]);
    const dominate = result.chunks.find((c) => c.chunk_id === "brain/card-vault/kw-dominate")!;
    expect(dominate.links).toEqual(["kw-go-again", "keywords-index"].sort());

    const ruling = result.chunks.find((c) => c.chunk_id === "brain/judge/ruling-dominate-timing")!;
    expect(ruling.links).toEqual(["kw-dominate"]);
  });

  it("produces stable chunk_ids and identical output across two runs (unchanged fixtures)", () => {
    const first = exportBrainNotes(IDENTITIES_ROOT, ["judge", "player", "card-vault"]);
    const second = exportBrainNotes(IDENTITIES_ROOT, ["judge", "player", "card-vault"]);
    expect(second.chunks).toEqual(first.chunks);
  });

  it("returns an empty result for an identity with no notes directory", () => {
    const result = exportBrainNotes(IDENTITIES_ROOT, ["nonexistent-identity"]);
    expect(result.chunks).toEqual([]);
    expect(result.countsByIdentity["nonexistent-identity"]).toBe(0);
  });

  it("skips a broken symlink (missing target) instead of crashing the whole export", () => {
    // judge/brain/notes/kw-ghost.md points at a target that was never created.
    const result = exportBrainNotes(IDENTITIES_ROOT, ["judge", "player", "card-vault"]);

    const ids = result.chunks.map((c) => c.chunk_id);
    expect(ids).not.toContain("brain/judge/kw-ghost");
    // every other note in the fixture tree still exports normally
    expect(ids).toContain("brain/judge/ruling-dominate-timing");
    expect(ids).toContain("brain/card-vault/kw-dominate");

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].path).toContain("kw-ghost.md");
    expect(result.skipped[0].reason).toMatch(/ENOENT|no such file/i);
  });

  it("resolves a two-hop symlink chain to its final owning identity and dedupes to one chunk", () => {
    // card-vault/.../kw-chained.md (physical) <- judge/.../kw-chained.md (symlink)
    // <- player/.../kw-chained.md (symlink-to-a-symlink)
    const result = exportBrainNotes(IDENTITIES_ROOT, ["judge", "player", "card-vault"]);

    const chained = result.chunks.filter((c) => c.chunk_id.endsWith("/kw-chained"));
    expect(chained).toHaveLength(1);
    expect(chained[0].chunk_id).toBe("brain/card-vault/kw-chained");
  });
});
