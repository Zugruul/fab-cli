/**
 * Printing search + resolution for the labeling tool's picker (issue #258).
 *
 * Deliberately a SEPARATE extraction from images/catalog.ts's
 * extractPrintingImageRefs rather than reusing it: that function's
 * PrintingImageRef intentionally strips edition/foiling/rarity/
 * art_variations (it only needs enough to download+cache an image), but
 * this tool needs those extra fields to disambiguate printings that share
 * a set+collector code (see resolvePrinting's doc comment). Keeping this
 * extraction local avoids widening images/catalog.ts's contract — and the
 * risk of changing behavior for its existing consumers (images/cli.ts,
 * composites/cli.ts) — for a need that's specific to this tool.
 *
 * HARD RULE (issue #258): resolvePrinting NEVER silently picks one
 * candidate out of several. Verified live example: the-fab-cube's HER155
 * (Groundbreaker Crix) maps to two printings with identical set/rarity/
 * foiling/art_variations and different unique_ids (front/back image
 * variants of the same promo) — see this module's test for the exact
 * fixture. A caller MUST treat `status: "ambiguous"` as "show the human a
 * picker", never as "use candidates[0]".
 */

export interface RawCatalogPrinting {
  unique_id?: unknown;
  id?: unknown;
  set_id?: unknown;
  edition?: unknown;
  foiling?: unknown;
  rarity?: unknown;
  art_variations?: unknown;
  image_url?: unknown;
}

export interface RawCatalogCard {
  name?: unknown;
  printings?: unknown;
}

export interface CatalogPrinting {
  /** The-fab-cube's printing-level unique_id — the ONLY valid printingId
   * for a benchmark label's Quad (see benchmark/types.ts). */
  printingId: string;
  /** Human-readable set+collector-number print code, e.g. "HER155". NOT
   * safe as a printingId on its own — see this module's doc comment. */
  printCode: string;
  cardName: string;
  setId: string;
  edition: string;
  foiling: string;
  rarity: string;
  artVariations: string[];
  imageUrl: string;
}

/**
 * Reads the-fab-cube's vendored card.json shape and extracts one entry per
 * printing that carries both a real image_url and unique_id — same skip
 * discipline as images/catalog.ts's extractPrintingImageRefs (a printing
 * missing either is skipped rather than fabricating a value).
 */
export function extractCatalogPrintings(cards: RawCatalogCard[]): CatalogPrinting[] {
  const entries: CatalogPrinting[] = [];
  for (const card of cards) {
    const printings = Array.isArray(card.printings) ? (card.printings as RawCatalogPrinting[]) : [];
    for (const printing of printings) {
      if (typeof printing.image_url !== "string" || printing.image_url.length === 0) continue;
      if (typeof printing.unique_id !== "string" || printing.unique_id.length === 0) continue;
      entries.push({
        printingId: printing.unique_id,
        printCode: typeof printing.id === "string" ? printing.id : "",
        cardName: typeof card.name === "string" ? card.name : "",
        setId: typeof printing.set_id === "string" ? printing.set_id : "",
        edition: typeof printing.edition === "string" ? printing.edition : "",
        foiling: typeof printing.foiling === "string" ? printing.foiling : "",
        rarity: typeof printing.rarity === "string" ? printing.rarity : "",
        artVariations: Array.isArray(printing.art_variations) ? (printing.art_variations as string[]) : [],
        imageUrl: printing.image_url,
      });
    }
  }
  return entries;
}

export function searchByName(entries: CatalogPrinting[], query: string): CatalogPrinting[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  return entries.filter((e) => e.cardName.toLowerCase().includes(needle));
}

/** Filename-convention edition token ("U"/"1st") translated to the-fab-
 * cube's internal edition code, per the brain-note legend (F=First,
 * U=Unlimited, A=Alpha, N=none/post-Uprising) — "1st" in a filename means
 * First edition. */
function editionHintToCode(hint: "U" | "1st" | null): string | null {
  if (hint === "U") return "U";
  if (hint === "1st") return "F";
  return null;
}

export interface PrintingHint {
  printCode: string | null;
  edition: "U" | "1st" | null;
}

export type PrintingResolution =
  | { status: "unique"; printing: CatalogPrinting }
  | { status: "ambiguous"; candidates: CatalogPrinting[] }
  | { status: "not-found"; candidates: CatalogPrinting[] };

/**
 * Resolves a filename's parsed hint to a printing. Resolution is
 * deterministic and additive (exact print-code match, then narrow by
 * edition if that still leaves more than one) — it never falls back to
 * "pick the first" or any other guess. Anything short of exactly one
 * remaining candidate comes back as "ambiguous" (2+) or "not-found" (0),
 * both of which the UI must render as a picker requiring a human choice.
 */
export function resolvePrinting(entries: CatalogPrinting[], hint: PrintingHint): PrintingResolution {
  if (hint.printCode === null) {
    return { status: "not-found", candidates: [] };
  }

  const byCode = entries.filter((e) => e.printCode.toUpperCase() === hint.printCode!.toUpperCase());
  if (byCode.length === 0) return { status: "not-found", candidates: [] };
  if (byCode.length === 1) return { status: "unique", printing: byCode[0] };

  const editionCode = editionHintToCode(hint.edition);
  const narrowed = editionCode === null ? byCode : byCode.filter((e) => e.edition === editionCode);
  const candidates = narrowed.length > 0 ? narrowed : byCode;

  if (candidates.length === 1) return { status: "unique", printing: candidates[0] };
  return { status: "ambiguous", candidates };
}

export interface CombinedHint extends PrintingHint {
  /** Free-text name query — either the user's typed picker search, or a
   * filename-parsed card name used as a fallback when the print code
   * didn't resolve. */
  nameQuery: string | null;
}

/**
 * Server-facing combined resolution: prefers an exact print-code match
 * (resolvePrinting); when the code is absent or resolves to nothing, falls
 * back to a name search. Same "never guess" contract as resolvePrinting —
 * 0 matches is not-found, 1 is unique, 2+ is ambiguous — whichever path
 * produced the candidates. A code match that comes back ambiguous is
 * returned as-is (never silently widened into a name search — the code
 * DID identify the right family of printings, it just didn't narrow to
 * one, so a human pick from those candidates is still the right UI, not a
 * broader/less precise name search).
 */
export function resolveCandidates(entries: CatalogPrinting[], hint: CombinedHint): PrintingResolution {
  if (hint.printCode !== null) {
    const byCode = resolvePrinting(entries, { printCode: hint.printCode, edition: hint.edition });
    if (byCode.status !== "not-found") return byCode;
  }

  if (hint.nameQuery === null || hint.nameQuery.trim().length === 0) {
    return { status: "not-found", candidates: [] };
  }

  const matches = searchByName(entries, hint.nameQuery);
  if (matches.length === 0) return { status: "not-found", candidates: [] };
  if (matches.length === 1) return { status: "unique", printing: matches[0] };
  return { status: "ambiguous", candidates: matches };
}
