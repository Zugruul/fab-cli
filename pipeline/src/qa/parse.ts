import type { Chunk, ParseResult, QAPair, RejectedEntry } from "./types.js";

/**
 * Strips a wrapping ```json ... ``` / ``` ... ``` code fence if present,
 * otherwise returns the input unchanged. Teacher models routinely wrap
 * "just JSON" responses in a fence despite instructions not to.
 */
function stripCodeFence(raw: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  return fenced ? fenced[1].trim() : raw.trim();
}

/** Last-resort repair: grab the outermost `[...]` substring, for responses
 * that include stray prose around an otherwise-valid JSON array. */
function extractArraySubstring(raw: string): string | null {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  return raw.slice(start, end + 1);
}

function tryParseJson(raw: string): unknown | undefined {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Parses one teacher response for a single chunk into accepted pairs +
 * rejected candidates (SPEC-APP.md §7.3: "robust parse-with-repair"; reject
 * entries whose cited_chunk_ids aren't the source chunk). Never throws —
 * an unparseable or malformed response yields an empty pairs[] plus a
 * RejectedEntry explaining why, so a single bad response never aborts the
 * batch run (see runner.ts's per-entry failure isolation).
 */
export function parseTeacherResponse(raw: string, chunk: Chunk): ParseResult {
  const candidates = [raw, stripCodeFence(raw)];
  const arraySubstring = extractArraySubstring(raw);
  if (arraySubstring) candidates.push(arraySubstring);

  let parsed: unknown | undefined;
  for (const candidate of candidates) {
    parsed = tryParseJson(candidate);
    if (parsed !== undefined) break;
  }

  if (parsed === undefined) {
    return { pairs: [], rejected: [{ reason: "unparseable JSON response", raw }] };
  }

  if (!Array.isArray(parsed)) {
    return { pairs: [], rejected: [{ reason: "response is not a JSON array", raw: parsed }] };
  }

  const pairs: QAPair[] = [];
  const rejected: RejectedEntry[] = [];

  for (const entry of parsed) {
    const validated = validateEntry(entry, chunk.chunk_id);
    if ("pair" in validated) {
      pairs.push(validated.pair);
    } else {
      rejected.push({ reason: validated.reason, raw: entry });
    }
  }

  return { pairs, rejected };
}

type ValidationResult = { pair: QAPair } | { reason: string };

function validateEntry(entry: unknown, sourceChunkId: string): ValidationResult {
  if (typeof entry !== "object" || entry === null) {
    return { reason: "entry is not a JSON object" };
  }
  const obj = entry as Record<string, unknown>;

  const question = obj.question;
  const answer = obj.answer;
  const citedChunkIds = obj.cited_chunk_ids;

  if (typeof question !== "string" || typeof answer !== "string" || !Array.isArray(citedChunkIds)) {
    return { reason: "entry missing required question/answer/cited_chunk_ids fields" };
  }
  if (question.trim().length === 0) {
    return { reason: "entry has an empty question" };
  }
  if (answer.trim().length === 0) {
    return { reason: "entry has an empty answer" };
  }
  if (citedChunkIds.length === 0) {
    return { reason: "entry has empty cited_chunk_ids" };
  }
  const allStrings = citedChunkIds.every((id): id is string => typeof id === "string");
  if (!allStrings) {
    return { reason: "entry cited_chunk_ids contains a non-string value" };
  }
  const onlyCitesSource = (citedChunkIds as string[]).every((id) => id === sourceChunkId);
  if (!onlyCitesSource) {
    return { reason: "entry cites chunk_id(s) outside the source chunk" };
  }

  return {
    pair: {
      question,
      answer,
      cited_chunk_ids: Array.from(new Set(citedChunkIds as string[])),
    },
  };
}
