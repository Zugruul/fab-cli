import { AnthropicTeacherClient } from "./teacher.js";
import { ClaudeCodeTeacherClient } from "./claudeCodeTeacher.js";
import type { EngineId, TeacherClient } from "./types.js";

export type { EngineId };

/**
 * Engine selection (SPEC-APP.md §7.3, issue #223) — see the `EngineId`
 * doc comment in types.ts for what each engine id means.
 *
 * "claude-code-subscription" is DEFAULT_ENGINE_ID and is NEVER auto-
 * upgraded to "anthropic-api" just because ANTHROPIC_API_KEY happens to be
 * set in the environment — selecting the billable engine is always an
 * explicit choice (CLI `--engine anthropic-api`, or `engine:
 * "anthropic-api"` in committed config), never an implicit fallback. See
 * pipeline/src/qa/README.md and cli.ts's resolveEngineId.
 */
export const DEFAULT_ENGINE_ID: EngineId = "claude-code-subscription";

export const ENGINE_IDS: readonly EngineId[] = ["claude-code-subscription", "anthropic-api"];

export function isEngineId(value: string): value is EngineId {
  return (ENGINE_IDS as readonly string[]).includes(value);
}

/** Builds the real TeacherClient for the given engine id. Never called for
 * a dry run — cli.ts's dry-run path never constructs a real transport. */
export function buildTeacherClient(engineId: EngineId): TeacherClient {
  switch (engineId) {
    case "claude-code-subscription":
      return new ClaudeCodeTeacherClient();
    case "anthropic-api":
      return new AnthropicTeacherClient();
  }
}
