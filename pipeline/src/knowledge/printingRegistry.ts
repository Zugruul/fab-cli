/**
 * APP-085 (SPEC-APP.md §8.8, §4 Glossary "Printing-id registry"; issue
 * #142): "Append-only mapping printing -> stable dense integer id,
 * versioned inside the knowledge pack; the shared namespace for
 * image-index vectors and catalog/QR encoding."
 *
 * The load-bearing invariant: an existing `registryId` is NEVER remapped
 * across builds. A printing dropping out of the corpus (a reprint
 * correction, a data-source fix) is marked `dead: true` but its entry —
 * and its id — STAYS in the registry forever; a printing that later
 * reappears is revived at its ORIGINAL id, never reallocated a new one.
 * This is what keeps on-device KNN ids and catalog references stable
 * across pack updates (§9.5's delta-apply path, §12's catalog store).
 */
import type { PrintingRegistry, PrintingRegistryEntry } from "./types.js";

export function buildPrintingRegistry(
  printingIds: readonly string[],
  previous: PrintingRegistry | null,
  version: string,
): PrintingRegistry {
  const seenInput = new Set<string>();
  for (const id of printingIds) {
    if (seenInput.has(id)) {
      throw new Error(`buildPrintingRegistry: duplicate printingId "${id}" in input`);
    }
    seenInput.add(id);
  }

  const currentSet = seenInput;
  const prevEntries = previous?.entries ?? [];

  const carried = new Set<string>();
  let maxRegistryId = -1;
  const entries: PrintingRegistryEntry[] = prevEntries.map((entry) => {
    maxRegistryId = Math.max(maxRegistryId, entry.registryId);
    carried.add(entry.printingId);
    return { printingId: entry.printingId, registryId: entry.registryId, dead: !currentSet.has(entry.printingId) };
  });

  const newIds = [...currentSet].filter((id) => !carried.has(id)).sort();
  for (const id of newIds) {
    maxRegistryId += 1;
    entries.push({ printingId: id, registryId: maxRegistryId, dead: false });
  }

  return { version, entries };
}
