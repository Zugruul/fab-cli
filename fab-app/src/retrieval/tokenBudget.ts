/** chars/4 token-estimation heuristic (§14: "token estimation: chars/4
 * heuristic documented, exact tokenizer later"). `charsPerToken` is a
 * config value (default 4), not a hardcoded constant, so it can be swapped
 * out once an exact tokenizer lands. */
export function estimateTokens(text: string, charsPerToken: number): number {
  return Math.ceil(text.length / charsPerToken);
}
