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

    // 4 physical notes total: card-vault has kw-dominate.md + card-heartstoker-branchblade.md,
    // judge has ruling-dominate-timing.md (+ a kw-dominate.md symlink), player has
    // strategy-blocking-basics.md (+ a kw-dominate.md symlink). The two symlinks must dedupe
    // to a single chunk owned by card-vault, not appear twice.
    expect(result.chunks).toHaveLength(4);

    const ids = result.chunks.map((c) => c.chunk_id).sort();
    expect(ids).toEqual([
      "brain/card-vault/card-heartstoker-branchblade",
      "brain/card-vault/kw-dominate",
      "brain/judge/ruling-dominate-timing",
      "brain/player/strategy-blocking-basics",
    ]);

    // the symlinked note is owned by card-vault, not judge or player
    expect(result.countsByIdentity["judge"]).toBe(1);
    expect(result.countsByIdentity["player"]).toBe(1);
    expect(result.countsByIdentity["card-vault"]).toBe(2);
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
});
