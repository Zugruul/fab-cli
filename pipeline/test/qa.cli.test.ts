// BUG-190: dataset generation must read pipeline/out/chunks-fulltext.jsonl
// (the parallel, always-full-text export output — see export.ts /
// shippingModes.ts), not out/chunks.jsonl, which the exporter now stubs for
// stub-mode sources (e.g. lore) per docs/rights-assessment.md §7.10's
// "Known follow-up gap". Falling back silently to chunks.jsonl when
// chunks-fulltext.jsonl is absent would regenerate training data against
// the stub marker instead of real prose, invisibly — so absence must be a
// loud failure telling the caller to re-run export, never a silent
// fallback to the (possibly-stubbed) chunks.jsonl.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseArgs, loadChunks } from "../src/qa/cli.js";
import { STUB_TEXT_MARKER } from "../src/shippingModes.js";

const LORE_CHUNK = {
  chunk_id: "lore/world-of-rathe/demonastery",
  title: "Demonastery",
  text: "The Demonastery is where Lord Sutcliffe was once imprisoned, long before the events of the current telling.",
  source: "https://legendarystories.net/world-of-rathe/demonastery.html",
  links: [],
  tags: ["lore"],
};

describe("qa/cli.ts — reads chunks-fulltext.jsonl, not chunks.jsonl (BUG-190)", () => {
  it("defaults --chunks to out/chunks-fulltext.jsonl, not out/chunks.jsonl", () => {
    const args = parseArgs([]);
    expect(path.basename(args.chunksPath)).toBe("chunks-fulltext.jsonl");
  });

  it("an explicit --chunks flag still overrides the default", () => {
    const args = parseArgs(["--chunks", "/tmp/custom-chunks.jsonl"]);
    expect(args.chunksPath).toBe("/tmp/custom-chunks.jsonl");
  });

  describe("loadChunks", () => {
    let tmpDir: string;
    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-qa-cli-fulltext-test-"));
    });
    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("returns the real prose text from a fulltext-shaped file, exactly as written", () => {
      const chunksPath = path.join(tmpDir, "chunks-fulltext.jsonl");
      fs.writeFileSync(chunksPath, JSON.stringify(LORE_CHUNK) + "\n");
      expect(loadChunks(chunksPath)).toEqual([LORE_CHUNK]);
    });

    it("never returns the stub marker when pointed at the fulltext file (regression guard)", () => {
      const chunksPath = path.join(tmpDir, "chunks-fulltext.jsonl");
      fs.writeFileSync(chunksPath, JSON.stringify(LORE_CHUNK) + "\n");
      const [chunk] = loadChunks(chunksPath);
      expect(chunk.text).not.toBe(STUB_TEXT_MARKER);
      expect(chunk.text).not.toMatch(/retrieval stub/i);
    });

    it("fails loudly with a re-run-export message when chunks-fulltext.jsonl is absent, rather than silently falling back to a sibling chunks.jsonl", () => {
      const missingPath = path.join(tmpDir, "chunks-fulltext.jsonl");
      // A stubbed chunks.jsonl sits right next to it — proves there's no
      // silent same-directory fallback to it.
      fs.writeFileSync(
        path.join(tmpDir, "chunks.jsonl"),
        JSON.stringify({ ...LORE_CHUNK, text: STUB_TEXT_MARKER }) + "\n",
      );
      expect(() => loadChunks(missingPath)).toThrow(/chunks-fulltext\.jsonl/);
      expect(() => loadChunks(missingPath)).toThrow(/export/i);
    });
  });
});
