import { describe, it, expect } from "vitest";
import { parseLabelFilename } from "../src/benchmark-label/filenameConvention.js";

// Real filenames from the user's first shooting batch (~/Downloads/real-caps/,
// issue #258 addendum 2026-08-04) — the ingest contract this parser targets.
describe("parseLabelFilename — real batch filenames", () => {
  it("parses a plain non-foil sleeved card with a repeat suffix", () => {
    const r = parseLabelFilename("ANQ001-sleeved-heart-of-fyendal-nf-2.jpeg");
    expect(r.parsed).toBe(true);
    if (!r.parsed) throw new Error("expected parsed");
    expect(r.printCode).toBe("ANQ001");
    expect(r.edition).toBeNull();
    expect(r.sleeved).toBe(true);
    expect(r.foil).toBe(false);
    expect(r.marvel).toBe(false);
    expect(r.cardNameSlug).toBe("heart-of-fyendal");
    expect(r.cardNameQuery).toBe("heart of fyendal");
    expect(r.repeat).toBe(2);
  });

  it("parses without a repeat suffix", () => {
    const r = parseLabelFilename("ANQ001-sleeved-heart-of-fyendal-nf.jpeg");
    expect(r.parsed).toBe(true);
    if (!r.parsed) throw new Error("expected parsed");
    expect(r.repeat).toBeNull();
  });

  it("parses unsleeved", () => {
    const r = parseLabelFilename("ANQ001-unsleeved-heart-of-fyendal-nf.jpeg");
    expect(r.parsed).toBe(true);
    if (!r.parsed) throw new Error("expected parsed");
    expect(r.sleeved).toBe(false);
  });

  it("parses an edition marker (-U) and rainbow foil, multi-word hyphenated name", () => {
    const r = parseLabelFilename("ARC000-U-sleeved-eye-of-ophidia-rf-2.jpeg");
    expect(r.parsed).toBe(true);
    if (!r.parsed) throw new Error("expected parsed");
    expect(r.printCode).toBe("ARC000");
    expect(r.edition).toBe("U");
    expect(r.cardNameSlug).toBe("eye-of-ophidia");
    expect(r.foil).toBe(true);
  });

  it("parses a marvel card — marvel flag set, foil independently from cf/rf/nf, and marvel is NOT itself a tag", () => {
    const r = parseLabelFilename("HER155-sleeved-groundbreaker-crix-marvel-cf.jpeg");
    expect(r.parsed).toBe(true);
    if (!r.parsed) throw new Error("expected parsed");
    expect(r.cardNameSlug).toBe("groundbreaker-crix");
    expect(r.marvel).toBe(true);
    expect(r.foil).toBe(true); // cf = cold foil
  });

  it("parses cold foil without marvel", () => {
    const r = parseLabelFilename("SUP000-sleeved-authority-of-ataya-cf.jpeg");
    expect(r.parsed).toBe(true);
    if (!r.parsed) throw new Error("expected parsed");
    expect(r.cardNameSlug).toBe("authority-of-ataya");
    expect(r.marvel).toBe(false);
    expect(r.foil).toBe(true);
    expect(r.repeat).toBeNull();
  });

  it("parses SUP000-sleeved-authority-of-ataya-cf-2.jpeg with repeat", () => {
    const r = parseLabelFilename("SUP000-sleeved-authority-of-ataya-cf-2.jpeg");
    expect(r.parsed).toBe(true);
    if (!r.parsed) throw new Error("expected parsed");
    expect(r.repeat).toBe(2);
  });

  it("handles a leading directory component in the path (only the basename is parsed)", () => {
    const r = parseLabelFilename("single/ANQ001-sleeved-heart-of-fyendal-nf.jpeg");
    expect(r.parsed).toBe(true);
    if (!r.parsed) throw new Error("expected parsed");
    expect(r.cardNameSlug).toBe("heart-of-fyendal");
  });

  it("accepts the documented no-code form (issue text's literal example)", () => {
    const r = parseLabelFilename("sleeved-command-and-conquer-nf.jpeg");
    expect(r.parsed).toBe(true);
    if (!r.parsed) throw new Error("expected parsed");
    expect(r.printCode).toBeNull();
    expect(r.cardNameSlug).toBe("command-and-conquer");
  });
});

describe("parseLabelFilename — lenient-but-visible failure", () => {
  it("reports unparsed (never guesses/defaults) for a filename missing the sleeved/unsleeved token", () => {
    const r = parseLabelFilename("random-photo-001.jpeg");
    expect(r.parsed).toBe(false);
  });

  it("reports unparsed for a filename with no foil code", () => {
    const r = parseLabelFilename("sleeved-heart-of-fyendal.jpeg");
    expect(r.parsed).toBe(false);
  });

  it("reports unparsed for a completely free-form filename, and never partially pre-fills", () => {
    const r = parseLabelFilename("IMG_20260804_142233.heic");
    expect(r.parsed).toBe(false);
    if (r.parsed) throw new Error("expected unparsed");
    expect(r.reason).toBeTruthy();
  });
});
