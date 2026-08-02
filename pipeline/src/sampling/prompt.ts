import type { Chunk, QAPair } from "./types.js";

export interface BuiltJudgePrompt {
  system: string;
  user: string;
}

const SYSTEM_PROMPT = `You are an entailment judge for Flesh & Blood training data (SPEC-APP.md §7.4).

You will be given a source chunk (an excerpt from the FAB rules corpus, a judge/player note, or
a lore page) and a candidate (question, answer) pair that claims to be grounded in that chunk.
Decide whether the answer is FULLY entailed by the chunk text: every fact, ruling, or example in
the answer must be stated in (or a direct, unambiguous restatement of) the chunk. An answer that
adds outside facts, extrapolates beyond the chunk, or contradicts the chunk is NOT entailed, even
if the addition happens to be true.

Output format (STRICT):
Respond with ONLY a JSON object, no prose before or after it, no markdown code fence, with
exactly these keys:
  "entailed": boolean
  "reason": string (briefly explain your verdict — what supports it, or what's unsupported)

Example shape: {"entailed": false, "reason": "..."}`;

/**
 * Builds the (system, user) prompt pair for one (chunk, pair) entailment
 * check (SPEC-APP.md §7.4). Pure and synchronous — no I/O — so it's
 * trivially unit-testable and safe to call from the dry-run path without
 * touching the network.
 */
export function buildJudgePrompt(chunk: Chunk, pair: QAPair): BuiltJudgePrompt {
  const user = `chunk_id: ${chunk.chunk_id}
title: ${chunk.title}

chunk text:
"""
${chunk.text}
"""

candidate question: ${pair.question}
candidate answer: ${pair.answer}

Is the candidate answer fully entailed by the chunk text above? Respond with the JSON object now.`;

  return { system: SYSTEM_PROMPT, user };
}
