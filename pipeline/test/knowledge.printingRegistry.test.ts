// APP-085 (SPEC-APP.md §8.8, §4 Glossary "Printing-id registry"; issue
// #142): "Append-only mapping printing -> stable dense integer id ...
// the shared namespace for image-index vectors and catalog/QR encoding."
// The load-bearing property: existing ids are NEVER remapped across
// builds — a remapped id would silently corrupt every user's on-device
// catalog references (§9.5's delta-apply path, §12's catalog store). This
// suite property-tests that by building twice with additions/removals in
// between, per the dev brain's boundary-convention-before-first-test and
// test-knob-intersections lessons: a tombstoned id must STAY in the
// registry (marked dead), never be dropped or reused.
import { describe, it, expect } from "vitest";
import { buildPrintingRegistry } from "../src/knowledge/printingRegistry.js";

function entryFor(registry: ReturnType<typeof buildPrintingRegistry>, printingId: string) {
  return registry.entries.find((e) => e.printingId === printingId);
}

describe("buildPrintingRegistry", () => {
  it("boundary: empty printingIds + no previous registry produces an empty, valid registry", () => {
    const registry = buildPrintingRegistry([], null, "1.0.0");
    expect(registry.entries).toEqual([]);
    expect(registry.version).toBe("1.0.0");
  });

  it("assigns dense integer ids to a fresh registry, all alive", () => {
    const registry = buildPrintingRegistry(["p3", "p1", "p2"], null, "1.0.0");
    expect(registry.entries).toHaveLength(3);
    const ids = registry.entries.map((e) => e.registryId).sort((a, b) => a - b);
    expect(ids).toEqual([0, 1, 2]);
    expect(registry.entries.every((e) => e.dead === false)).toBe(true);
  });

  it("assigning ids for the same input twice (no previous) is deterministic", () => {
    const a = buildPrintingRegistry(["p3", "p1", "p2"], null, "1.0.0");
    const b = buildPrintingRegistry(["p3", "p1", "p2"], null, "1.0.0");
    expect(a.entries.slice().sort((x, y) => x.printingId.localeCompare(y.printingId))).toEqual(
      b.entries.slice().sort((x, y) => x.printingId.localeCompare(y.printingId)),
    );
  });

  it("throws on a duplicate printingId in the input", () => {
    expect(() => buildPrintingRegistry(["p1", "p1"], null, "1.0.0")).toThrow(/duplicate/i);
  });

  // --- THE property test (APP-085 AC) ------------------------------------
  it("PROPERTY: building twice with additions in between never remaps any id from build 1", () => {
    const gen1 = buildPrintingRegistry(["p1", "p2", "p3"], null, "1.0.0");
    const gen2 = buildPrintingRegistry(["p1", "p2", "p3", "p4", "p5"], gen1, "1.1.0");

    for (const e1 of gen1.entries) {
      const e2 = entryFor(gen2, e1.printingId);
      expect(e2).toBeDefined();
      expect(e2!.registryId).toBe(e1.registryId);
      expect(e2!.dead).toBe(false);
    }
    // new ids are appended above the existing max, not interleaved into it
    const gen1Max = Math.max(...gen1.entries.map((e) => e.registryId));
    for (const newId of ["p4", "p5"]) {
      expect(entryFor(gen2, newId)!.registryId).toBeGreaterThan(gen1Max);
    }
  });

  it("PROPERTY holds across three generations (delta spanning >1 snapshot gap, per boundary convention): gen1 -> gen3 ids match gen1 -> gen2 -> gen3", () => {
    const gen1 = buildPrintingRegistry(["p1", "p2"], null, "1.0.0");
    const gen2 = buildPrintingRegistry(["p1", "p2", "p3"], gen1, "1.1.0");
    const gen3 = buildPrintingRegistry(["p1", "p2", "p3", "p4"], gen2, "1.2.0");
    for (const e1 of gen1.entries) {
      expect(entryFor(gen3, e1.printingId)!.registryId).toBe(e1.registryId);
    }
    expect(entryFor(gen3, "p3")!.registryId).toBe(entryFor(gen2, "p3")!.registryId);
  });

  // --- Mutation-proof regression lock (review round 1, PR #241) ----------
  // Every fixture above only ever adds new ids that sort ALPHABETICALLY
  // AFTER the existing ones (p1..p3 -> +p4,p5), so a "recombine carried +
  // new ids, .sort(), registryId = array index" mutant passes all of them
  // — it only misbehaves when a NEW id sorts BEFORE an EXISTING alive id,
  // silently shifting the existing id's position in the resorted array.
  // These two tests are specifically shaped to kill that mutant.
  it("MUTATION-PROOF: a new printingId that sorts alphabetically BEFORE an existing alive id does not disturb the existing id's registryId", () => {
    const gen1 = buildPrintingRegistry(["p5"], null, "1.0.0");
    const p5Id = entryFor(gen1, "p5")!.registryId;

    const gen2 = buildPrintingRegistry(["p5", "p1"], gen1, "1.1.0"); // "p1" sorts before "p5"
    expect(entryFor(gen2, "p5")!.registryId).toBe(p5Id); // byte-identical, not shifted
    expect(entryFor(gen2, "p1")!.registryId).not.toBe(p5Id); // new id gets its OWN slot, not p5's
  });

  it("MUTATION-PROOF: a 3-generation shuffle (each generation adds ids in mixed alphabetical positions) never disturbs any prior mapping", () => {
    const gen1 = buildPrintingRegistry(["m"], null, "1.0.0");
    const mId = entryFor(gen1, "m")!.registryId;

    // "a" and "z" both added — "a" sorts before "m", "z" sorts after it.
    const gen2 = buildPrintingRegistry(["m", "a", "z"], gen1, "1.1.0");
    expect(entryFor(gen2, "m")!.registryId).toBe(mId);
    const aId = entryFor(gen2, "a")!.registryId;
    const zId = entryFor(gen2, "z")!.registryId;

    // "b" and "y" added — "b" sorts before both "m" and "z" (and after "a").
    const gen3 = buildPrintingRegistry(["m", "a", "z", "b", "y"], gen2, "1.2.0");
    expect(entryFor(gen3, "m")!.registryId).toBe(mId);
    expect(entryFor(gen3, "a")!.registryId).toBe(aId);
    expect(entryFor(gen3, "z")!.registryId).toBe(zId);
  });

  it("a printing removed from the corpus is marked dead but STAYS in the registry with its original id (tombstone convention)", () => {
    const gen1 = buildPrintingRegistry(["p1", "p2", "p3"], null, "1.0.0");
    const p2Id = entryFor(gen1, "p2")!.registryId;
    const gen2 = buildPrintingRegistry(["p1", "p3"], gen1, "1.1.0");

    expect(gen2.entries).toHaveLength(3); // still present, never dropped
    const p2 = entryFor(gen2, "p2")!;
    expect(p2.dead).toBe(true);
    expect(p2.registryId).toBe(p2Id); // never remapped
  });

  it("a printing that reappears after being tombstoned is revived at its ORIGINAL id, not reallocated a new one", () => {
    const gen1 = buildPrintingRegistry(["p1", "p2"], null, "1.0.0");
    const originalId = entryFor(gen1, "p2")!.registryId;
    const gen2 = buildPrintingRegistry(["p1"], gen1, "1.1.0"); // p2 tombstoned
    expect(entryFor(gen2, "p2")!.dead).toBe(true);

    const gen3 = buildPrintingRegistry(["p1", "p2"], gen2, "1.2.0"); // p2 comes back
    const revived = entryFor(gen3, "p2")!;
    expect(revived.dead).toBe(false);
    expect(revived.registryId).toBe(originalId);
  });

  it("a completely unknown printingId (never in previous or current) is simply absent, not spuriously tombstoned", () => {
    const gen1 = buildPrintingRegistry(["p1", "p2"], null, "1.0.0");
    const gen2 = buildPrintingRegistry(["p1", "p2"], gen1, "1.1.0");
    expect(entryFor(gen2, "never-existed")).toBeUndefined();
  });
});
