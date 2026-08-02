import type { z } from "zod";

export interface ValidationIssue {
  path: (string | number)[];
  message: string;
}

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: ValidationIssue[] };

/**
 * Wraps zod's safeParse into a plain, typed result with precise error
 * paths (dot/bracket-free — an array of path segments, e.g.
 * ["sources", 0, "shippingMode"]) so callers don't need to know zod's own
 * error-object shape.
 */
export function validate<T>(schema: z.ZodType<T>, input: unknown): ValidationResult<T> {
  const result = schema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.issues.map((issue) => ({ path: issue.path as (string | number)[], message: issue.message })),
  };
}
