import { describe, it, expect } from "vitest";
import { extractWikilinks } from "../src/links.js";

describe("extractWikilinks", () => {
  it("extracts unique, sorted [[slug]] references", () => {
    const text = "See [[kw-dominate]] and [[kw-go-again]], also [[kw-dominate]] again.";
    expect(extractWikilinks(text)).toEqual(["kw-dominate", "kw-go-again"]);
  });

  it("returns an empty array when there are no wikilinks", () => {
    expect(extractWikilinks("plain text, no links here")).toEqual([]);
  });
});
