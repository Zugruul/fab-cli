/**
 * Parses the user's real-photo shooting filename convention (issue #258
 * addendum, 2026-08-04) into pre-fill hints for the labeling tool:
 *
 *   <SETCODE><NUM>[-U|-1st]-<sleeved|unsleeved>-<card-name-slug>-[marvel-]<cf|rf|nf>[-N].<ext>
 *
 * verified against the first real batch (~/Downloads/real-caps/, 15 files),
 * e.g. `ARC000-U-sleeved-eye-of-ophidia-rf-2.jpeg`. The set+collector-number
 * prefix is optional (the issue text's own literal example omits it), so
 * both forms are accepted.
 *
 * HARD RULE (issue #258): parsing is all-or-nothing. A filename that
 * doesn't fully match is reported unparsed — never partially pre-filled —
 * because a silently-wrong pre-filled tag is worse than an empty one (the
 * human stops checking a field that's already filled in).
 *
 * `marvel` is parsed and surfaced (`marvel: true`) but is NOT itself
 * translated into a tag: the label schema's tag vocabulary is fixed at
 * `sleeved | foil | glare` (benchmark/types.ts's QUAD_TAGS) and has no
 * treatment/rarity slot. See this task's report for the open question this
 * raises — not something this parser decides.
 */

export interface ParsedLabelFilename {
  parsed: true;
  /** The-fab-cube human-readable set+number print code (e.g. "HER155"), or
   * null when the filename's optional code prefix wasn't present. NOT the
   * printing-level unique_id — see catalogSearch.ts for resolving this into
   * one. */
  printCode: string | null;
  /** Raw edition token from the filename ("U" or "1st"), or null when no
   * edition marker was present. Passed through as-is (not translated to
   * the-fab-cube's internal edition codes here) — catalogSearch.ts does
   * that translation where it matters for disambiguation. */
  edition: "U" | "1st" | null;
  sleeved: boolean;
  /** true for cf (cold foil) / rf (rainbow foil), false for nf (non-foil). */
  foil: boolean;
  /** true when the filename's "marvel" segment was present — a
   * treatment/rarity signal the current tag vocabulary cannot express. */
  marvel: boolean;
  cardNameSlug: string;
  /** cardNameSlug with hyphens replaced by spaces, for a name-search query. */
  cardNameQuery: string;
  /** Trailing "-N" repeat-shot suffix, or null when absent. */
  repeat: number | null;
}

export interface UnparsedLabelFilename {
  parsed: false;
  reason: string;
}

export type FilenameParseResult = ParsedLabelFilename | UnparsedLabelFilename;

const PATTERN =
  /^(?:([A-Z]{2,5}\d{2,4})(?:-(U|1st))?-)?(sleeved|unsleeved)-(.+?)-(?:(marvel)-)?(cf|rf|nf)(?:-(\d+))?$/;

/** Strips any directory prefix and the file extension, leaving just the
 * basename to match against — callers may pass either a bare filename or a
 * relative path like "single/ANQ001-sleeved-....jpeg". */
function basenameWithoutExtension(fileName: string): string {
  const base = fileName.split("/").pop() ?? fileName;
  return base.replace(/\.[^./]+$/, "");
}

export function parseLabelFilename(fileName: string): FilenameParseResult {
  const stem = basenameWithoutExtension(fileName);
  const match = PATTERN.exec(stem);
  if (!match) {
    return {
      parsed: false,
      reason: `"${fileName}" does not match the <sleeved|unsleeved>-<name>-[marvel-]<cf|rf|nf> convention — fill in manually`,
    };
  }

  const [, printCode, edition, sleeve, nameSlug, marvel, foilCode, repeat] = match;

  return {
    parsed: true,
    printCode: printCode ?? null,
    edition: (edition as "U" | "1st" | undefined) ?? null,
    sleeved: sleeve === "sleeved",
    foil: foilCode === "cf" || foilCode === "rf",
    marvel: marvel === "marvel",
    cardNameSlug: nameSlug,
    cardNameQuery: nameSlug.replace(/-/g, " "),
    repeat: repeat ? Number(repeat) : null,
  };
}
