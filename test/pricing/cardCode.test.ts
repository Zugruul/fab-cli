// Tests for src/pricing/cardCode.ts — SPEC-PRICE §4.3, §9.1, §9.3 card-code
// (e.g. "EVR141") lookup. Runs against the REAL vendored
// third_party/flesh-and-blood-cards data (same pattern as src/carddb.ts) —
// these are known, stable entries in that corpus, not synthetic fixtures.

import { describe, it, expect } from "vitest";
import { lookupCardCode } from "../../src/pricing/cardCode";

describe("lookupCardCode", () => {
  it("returns the correct code for an exact card/set/finish match", () => {
    // Haze Bending's Everfest printing (id EVR141) carries both a Standard
    // (normal) and a Rainbow Foil row under the same printing id.
    expect(lookupCardCode("Haze Bending", "Everfest", "normal")).toBe(
      "EVR141",
    );
  });

  it("distinguishes normal vs foil when they carry different codes", () => {
    // Ironsong Response's Local Game Store Promos printings: LGS008 is the
    // Standard (normal) row, LGS029 is a distinct Rainbow Foil row.
    expect(
      lookupCardCode("Ironsong Response", "Local Game Store Promos", "normal"),
    ).toBe("LGS008");
    expect(
      lookupCardCode("Ironsong Response", "Local Game Store Promos", "foil"),
    ).toBe("LGS029");
  });

  it("returns null (never throws) for an unknown card name", () => {
    expect(() =>
      lookupCardCode("Not A Real Card Name Xyz", "Everfest", "normal"),
    ).not.toThrow();
    expect(lookupCardCode("Not A Real Card Name Xyz", "Everfest", "normal")).toBe(
      null,
    );
  });

  it("returns null (never throws) for an unknown set on a known card", () => {
    expect(
      lookupCardCode("Haze Bending", "Not A Real Set Name", "normal"),
    ).toBe(null);
  });

  it("returns null for a finish with no matching printing in that set", () => {
    // Fyendal's Spring Tunic's Compendium of Rathe - Antiquity Pack printing
    // (ANQ006) is Rainbow Foil only — there is no Standard/normal row there.
    expect(
      lookupCardCode(
        "Fyendal's Spring Tunic",
        "Compendium of Rathe - Antiquity Pack",
        "normal",
      ),
    ).toBe(null);
    expect(
      lookupCardCode(
        "Fyendal's Spring Tunic",
        "Compendium of Rathe - Antiquity Pack",
        "foil",
      ),
    ).toBe("ANQ006");
  });

  it("normalizes the card name the same way compare.ts does (apostrophe-insensitive)", () => {
    expect(
      lookupCardCode(
        "Fyendals Spring Tunic",
        "Compendium of Rathe - Antiquity Pack",
        "foil",
      ),
    ).toBe("ANQ006");
  });

  it("normalizes the set name (case/whitespace-insensitive)", () => {
    expect(
      lookupCardCode("Haze Bending", "  everfest  ", "normal"),
    ).toBe("EVR141");
  });
});
