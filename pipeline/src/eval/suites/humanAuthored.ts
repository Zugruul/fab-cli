/**
 * Human-authored adjudication suite (SPEC-APP.md §8.4's anti-circularity
 * control): ≥100 committed items transcribed from Rules Reprise
 * worked examples and equivalent official/judge-community rulings — NOT
 * teacher-generated. Content lives under
 * pipeline/eval-suites/human-adjudication/*.json (committed, one file per
 * batch); this module only loads + validates it.
 *
 * RUNTIME GUARD (not just a TS type): every item's `sourceUrl` must be a
 * non-empty string. This is invariant-bearing per the task brief — a
 * content file that slips through review with a blank/missing sourceUrl
 * would silently defeat the whole point of the suite (an unverifiable
 * "transcription"), so it's checked here, at load time, every time,
 * loudly (throws), not just enforced by a TypeScript field being
 * `string` (which a JSON file trivially bypasses — JSON has no compiler).
 */
import fs from "node:fs";
import path from "node:path";
import type { EvalItem } from "../types.js";

/** On-disk shape of one committed item — deliberately narrower than
 * EvalItem: `suite` is implied (always "human-authored-adjudication") and
 * `expected` is always a rubric built from `expectedClaims` (these are
 * transcribed rulings, graded by the LLM judge against the transcribed
 * expected ruling, exactly like every other rubric item — see
 * suites/fromDataset.ts's doc comment for why a reference-text-as-claims
 * rubric is the harness's standard shape). */
export interface HumanAuthoredItemRecord {
  id: string;
  question: string;
  expectedClaims: string[];
  groundingChunkIds: string[];
  sourceUrl: string;
  adjudicationCritical?: boolean;
}

export class HumanAuthoredContentError extends Error {}

function validateRecord(record: unknown, file: string, index: number): asserts record is HumanAuthoredItemRecord {
  const r = record as Partial<HumanAuthoredItemRecord> | null;
  const where = `${file}[${index}]`;
  if (!r || typeof r !== "object") throw new HumanAuthoredContentError(`${where}: not an object`);
  if (typeof r.id !== "string" || r.id.length === 0) throw new HumanAuthoredContentError(`${where}: missing/empty "id"`);
  if (typeof r.question !== "string" || r.question.trim().length === 0) {
    throw new HumanAuthoredContentError(`${where} (id=${r.id}): missing/empty "question"`);
  }
  if (!Array.isArray(r.expectedClaims) || r.expectedClaims.length === 0 || r.expectedClaims.some((c) => typeof c !== "string" || c.trim().length === 0)) {
    throw new HumanAuthoredContentError(`${where} (id=${r.id}): "expectedClaims" must be a non-empty array of non-empty strings`);
  }
  if (!Array.isArray(r.groundingChunkIds)) {
    throw new HumanAuthoredContentError(`${where} (id=${r.id}): "groundingChunkIds" must be an array (may be empty)`);
  }
  // The invariant this whole module exists to enforce: see class doc.
  if (typeof r.sourceUrl !== "string" || r.sourceUrl.trim().length === 0) {
    throw new HumanAuthoredContentError(
      `${where} (id=${r.id}): missing/empty "sourceUrl" — every human-authored-adjudication item MUST cite its independent transcription source (SPEC-APP.md §8.4 anti-circularity control)`,
    );
  }
}

function toEvalItem(record: HumanAuthoredItemRecord): EvalItem {
  return {
    id: `human-authored-adjudication__${record.id}`,
    suite: "human-authored-adjudication",
    question: record.question,
    expected: { kind: "rubric", claims: record.expectedClaims },
    groundingChunkIds: record.groundingChunkIds,
    adjudicationCritical: record.adjudicationCritical ?? false,
    sourceUrl: record.sourceUrl,
  };
}

/** Loads every `*.json` file directly under `dir`, validates each record,
 * and converts to EvalItems. Files are read in sorted-filename order so
 * output is deterministic regardless of directory listing order. */
export function loadHumanAuthoredItems(dir: string): EvalItem[] {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const items: EvalItem[] = [];
  const seenIds = new Set<string>();
  for (const file of files) {
    const filePath = path.join(dir, file);
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (!Array.isArray(raw)) throw new HumanAuthoredContentError(`${file}: must contain a JSON array of items`);
    raw.forEach((record, i) => {
      validateRecord(record, file, i);
      if (seenIds.has(record.id)) {
        throw new HumanAuthoredContentError(`${file}[${i}]: duplicate item id "${record.id}"`);
      }
      seenIds.add(record.id);
      items.push(toEvalItem(record));
    });
  }
  return items;
}

// --- Near-duplicate detection (task brief: "a duplicate-similarity check
// in tests is a plus") -------------------------------------------------

function normalizeForDuplicateCheck(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function tokenSet(text: string): Set<string> {
  return new Set(normalizeForDuplicateCheck(text).split(" "));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface DuplicatePair {
  idA: string;
  idB: string;
  similarity: number;
}

/**
 * Flags item pairs whose question text is exact-duplicate or
 * near-duplicate (token-Jaccard similarity >= threshold, default 0.9) —
 * a coarse-but-cheap O(n^2) guard against padding the suite with
 * near-copies instead of genuinely distinct transcriptions. Intended for
 * test-time use against the real committed content, not the gate's hot
 * path.
 */
export function findNearDuplicateQuestions(items: readonly EvalItem[], threshold = 0.9): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  const sets = items.map((item) => tokenSet(item.question));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const similarity = jaccard(sets[i], sets[j]);
      if (similarity >= threshold) {
        pairs.push({ idA: items[i].id, idB: items[j].id, similarity });
      }
    }
  }
  return pairs;
}
