import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  applyShippingModes,
  loadShippingModes,
  sourceNameForChunk,
  STUB_TEXT_MARKER,
} from "../src/shippingModes.js";
import type { Chunk } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures");

function chunk(overrides: Partial<Chunk> & Pick<Chunk, "chunk_id">): Chunk {
  return {
    text: "real text",
    title: "title",
    source: "https://example.com",
    links: [],
    tags: [],
    ...overrides,
  };
}

describe("sourceNameForChunk", () => {
  it("derives brain/<identity>/<slug> -> <identity>-brain", () => {
    expect(sourceNameForChunk("brain/judge/ci-dominate")).toBe("judge-brain");
    expect(sourceNameForChunk("brain/card-vault/kw-go-again")).toBe("card-vault-brain");
  });

  it("derives rules/<document>/<section> -> rules-kb", () => {
    expect(sourceNameForChunk("rules/cr/1.1")).toBe("rules-kb");
  });

  it("derives lore/<path> -> lore", () => {
    expect(sourceNameForChunk("lore/other-characters/lord-sutcliffe")).toBe("lore");
  });

  it("throws on an unrecognized chunk_id scheme rather than guessing", () => {
    expect(() => sourceNameForChunk("mystery/whatever")).toThrow(/unrecognized/i);
  });
});

describe("loadShippingModes", () => {
  it("loads the committed real pipeline/config/shipping-modes.json", () => {
    const modes = loadShippingModes(
      path.join(__dirname, "..", "config", "shipping-modes.json"),
    );
    expect(modes["judge-brain"]).toBe("verbatim");
    expect(modes["player-brain"]).toBe("verbatim");
    expect(modes["card-vault-brain"]).toBe("verbatim");
    expect(modes["rules-kb"]).toBe("verbatim");
    expect(modes["lore"]).toBe("stub");
  });

  it("ignores underscore-prefixed keys (the _comment convention)", () => {
    const modes = loadShippingModes(path.join(FIXTURES, "shipping-modes.json"));
    expect(modes["_comment"]).toBeUndefined();
    expect(Object.keys(modes).sort()).toEqual(
      ["card-vault-brain", "judge-brain", "lore", "player-brain", "rules-kb"].sort(),
    );
  });

  it("throws loudly on an invalid mode value rather than passing it through", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shipping-modes-invalid-"));
    const badPath = path.join(tmp, "shipping-modes.json");
    fs.writeFileSync(badPath, JSON.stringify({ lore: "public-domain" }));
    try {
      expect(() => loadShippingModes(badPath)).toThrow(/invalid shipping mode/i);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("applyShippingModes", () => {
  const modes = loadShippingModes(path.join(FIXTURES, "shipping-modes.json"));

  it("stubs a stub-mode source's chunk text while keeping id/title/tags/source intact", () => {
    const loreChunk = chunk({
      chunk_id: "lore/other-characters/lord-sutcliffe",
      text: "Lord Sutcliffe was a knight of the old empire...",
      title: "Lord Sutcliffe",
      source: "https://legendarystories.net/other-characters/lord-sutcliffe.html",
      tags: ["lore"],
    });
    const { shipped, fullText } = applyShippingModes([loreChunk], modes);

    expect(shipped).toHaveLength(1);
    expect(shipped[0].text).toBe(STUB_TEXT_MARKER);
    expect(shipped[0].chunk_id).toBe(loreChunk.chunk_id);
    expect(shipped[0].title).toBe(loreChunk.title);
    expect(shipped[0].source).toBe(loreChunk.source);
    expect(shipped[0].tags).toEqual(loreChunk.tags);

    // the full-text set is untouched — this is chunks-fulltext.jsonl's content
    expect(fullText).toHaveLength(1);
    expect(fullText[0].text).toBe(loreChunk.text);
  });

  it("leaves a verbatim-mode source's chunk text unchanged in both outputs", () => {
    const rulesChunk = chunk({
      chunk_id: "rules/cr/1.1",
      text: "The full comprehensive rules text for section 1.1.",
    });
    const { shipped, fullText } = applyShippingModes([rulesChunk], modes);
    expect(shipped[0].text).toBe(rulesChunk.text);
    expect(fullText[0].text).toBe(rulesChunk.text);
    // identical in both files, per the two-file design (verbatim sources
    // ship the same content chunks.jsonl and chunks-fulltext.jsonl carry)
    expect(shipped[0]).toEqual(fullText[0]);
  });

  it("never mutates the input chunk array", () => {
    const rulesChunk = chunk({ chunk_id: "rules/cr/1.1", text: "original" });
    const loreChunkOriginal = chunk({ chunk_id: "lore/page", text: "original lore" });
    const input = [rulesChunk, loreChunkOriginal];
    applyShippingModes(input, modes);
    expect(input[0].text).toBe("original");
    expect(input[1].text).toBe("original lore");
  });

  it("loudly fails (config-assessment consistency check) when a chunk's source has no configured mode", () => {
    const incompleteModes = loadShippingModes(
      path.join(FIXTURES, "shipping-modes-missing-lore.json"),
    );
    const loreChunk = chunk({ chunk_id: "lore/some-page", text: "text" });
    expect(() => applyShippingModes([loreChunk], incompleteModes)).toThrow(
      /no shipping mode configured for source "lore"/,
    );
  });

  it("handles a mixed chunk set: only stub-mode sources' text is replaced", () => {
    const chunks = [
      chunk({ chunk_id: "brain/judge/ci-example", text: "judge note text" }),
      chunk({ chunk_id: "rules/cr/1.1", text: "cr text" }),
      chunk({ chunk_id: "lore/page-a", text: "lore text a" }),
      chunk({ chunk_id: "lore/page-b", text: "lore text b" }),
    ];
    const { shipped } = applyShippingModes(chunks, modes);
    const byId = Object.fromEntries(shipped.map((c) => [c.chunk_id, c.text]));
    expect(byId["brain/judge/ci-example"]).toBe("judge note text");
    expect(byId["rules/cr/1.1"]).toBe("cr text");
    expect(byId["lore/page-a"]).toBe(STUB_TEXT_MARKER);
    expect(byId["lore/page-b"]).toBe(STUB_TEXT_MARKER);
  });
});
