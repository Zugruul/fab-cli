import type { EntailmentVerdict } from "./types.js";

export type JudgeParseResult = { verdict: EntailmentVerdict } | { error: string };

/**
 * Strips a wrapping ```json ... ``` / ``` ... ``` code fence if present,
 * otherwise returns the input unchanged. Judge models routinely wrap
 * "just JSON" responses in a fence despite instructions not to (mirrors
 * qa/parse.ts's stripCodeFence).
 */
function stripCodeFence(raw: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  return fenced ? fenced[1].trim() : raw.trim();
}

/** Last-resort repair: grab the outermost `{...}` substring, for responses
 * that include stray prose around an otherwise-valid JSON object. */
function extractObjectSubstring(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
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
 * Parses one judge response into an entailment verdict (SPEC-APP.md §7.4).
 * Never throws — a refusal, truncated response, or otherwise unparseable/
 * malformed response yields `{ error }` rather than a verdict, so a single
 * bad judge response never aborts the batch run (see sampler.ts's
 * per-entry failure isolation): the caller treats a parse error the same
 * as a not-entailed verdict — fail closed, reject rather than guess.
 */
export function parseJudgeResponse(raw: string): JudgeParseResult {
  const candidates = [raw, stripCodeFence(raw)];
  const objectSubstring = extractObjectSubstring(raw);
  if (objectSubstring) candidates.push(objectSubstring);

  let parsed: unknown | undefined;
  for (const candidate of candidates) {
    parsed = tryParseJson(candidate);
    if (parsed !== undefined) break;
  }

  if (parsed === undefined) {
    return { error: "unparseable judge response" };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { error: "judge response is not a JSON object" };
  }

  const obj = parsed as Record<string, unknown>;
  const entailed = obj.entailed;
  const reason = obj.reason;

  if (typeof entailed !== "boolean") {
    return { error: "judge response missing boolean 'entailed' field" };
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return { error: "judge response missing non-empty 'reason' field" };
  }

  return { verdict: { entailed, reason } };
}
