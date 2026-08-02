import type { Chunk, PromptConfig } from "./types.js";

export interface BuiltPrompt {
  system: string;
  user: string;
}

const SYSTEM_PROMPT = `You are a Flesh & Blood rules and lore teacher generating grounded training data.

You will be given a single source chunk (an excerpt from the FAB rules corpus, a judge/player
note, or a lore page) identified by its chunk_id. Generate question/answer training pairs from
that chunk ONLY.

Hard requirements:
- Every answer must be fully supported by the chunk text. Do not invent, extrapolate, or
  fabricate facts, rulings, or examples that are not stated in the chunk — stay within the
  chunk text and only use what it actually says.
- Every pair must cite the chunk via "cited_chunk_ids": the chunk_id given to you, and nothing
  else. Never cite a different chunk_id.
- Vary phrasing across the pairs you generate for this chunk — do not produce near-duplicate
  questions.

Output format (STRICT):
Respond with ONLY a JSON array, no prose before or after it, no markdown code fence. Each
element is an object with exactly these keys:
  "question": string
  "answer": string
  "cited_chunk_ids": array of strings (must contain the given chunk_id and nothing else)

Example shape: [{"question": "...", "answer": "...", "cited_chunk_ids": ["<chunk_id>"]}]`;

/**
 * Builds the (system, user) prompt pair for one chunk (SPEC-APP.md §7.3).
 * Pure and synchronous — no I/O — so it's trivially unit-testable and safe
 * to call from the dry-run path without touching the network.
 */
export function buildPrompt(chunk: Chunk, config: PromptConfig): BuiltPrompt {
  const diversityLines = config.diversityInstructions.map((line) => `- ${line}`).join("\n");

  const user = `chunk_id: ${chunk.chunk_id}
title: ${chunk.title}
source: ${chunk.source}

chunk text:
"""
${chunk.text}
"""

Generate exactly ${config.pairsPerChunk} question/answer pairs grounded in the chunk text above.

Phrasing diversity instructions:
${diversityLines}

Respond with the JSON array now.`;

  return { system: SYSTEM_PROMPT, user };
}
