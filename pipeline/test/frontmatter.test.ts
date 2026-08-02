import { describe, it, expect } from "vitest";
import { parseNote } from "../src/frontmatter.js";

describe("parseNote", () => {
  it("parses scalar, list, bool, and int frontmatter fields", () => {
    const raw = `---
tags: [cr, keyword, ability, dominate]
paths: []
strength: 3
source: "https://example.com/cr#8.3.1"
graduated: false
created: 2026-01-15
---

**Dominate** — ability keyword.
`;
    const { frontmatter, body } = parseNote(raw);
    expect(frontmatter.tags).toEqual(["cr", "keyword", "ability", "dominate"]);
    expect(frontmatter.paths).toEqual([]);
    expect(frontmatter.strength).toBe(3);
    expect(frontmatter.source).toBe("https://example.com/cr#8.3.1");
    expect(frontmatter.graduated).toBe(false);
    expect(frontmatter.created).toBe("2026-01-15");
    expect(body.trim()).toBe("**Dominate** — ability keyword.");
  });

  it("splits quoted list items containing commas correctly", () => {
    const raw = `---
tags: [card, "pitch,red", heartstoker]
paths: ["decks/aggro"]
---
body text
`;
    const { frontmatter } = parseNote(raw);
    expect(frontmatter.tags).toEqual(["card", "pitch,red", "heartstoker"]);
    expect(frontmatter.paths).toEqual(["decks/aggro"]);
  });

  it("returns empty frontmatter and the full text as body when there is no frontmatter block", () => {
    const raw = "# Just a heading\n\nSome text.\n";
    const { frontmatter, body } = parseNote(raw);
    expect(frontmatter).toEqual({});
    expect(body).toBe(raw);
  });
});
