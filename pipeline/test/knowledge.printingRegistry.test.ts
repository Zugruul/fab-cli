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
