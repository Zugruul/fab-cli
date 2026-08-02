import { z } from "zod";

export const RevokedVersionSchema = z.object({
  artifact: z.string(),
  version: z.string(),
  reason: z.string(),
});
export type RevokedVersion = z.infer<typeof RevokedVersionSchema>;

/**
 * §4 Glossary "Manifest" / §9.5: "IF the active manifest's revoked-versions
 * list names a currently-installed artifact THEN THE SYSTEM SHALL stop
 * using it, notify the user, and download the newest non-revoked version."
 */
export const RevocationListSchema = z.object({
  schemaVersion: z.string().min(1),
  revokedVersions: z.array(RevokedVersionSchema),
});
export type RevocationList = z.infer<typeof RevocationListSchema>;
