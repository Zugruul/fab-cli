// BUG-183: behavior/types.ts's SampledRecordLike previously structurally
// duplicated sampling/store.ts's real SampledRecord, written while APP-012
// was an unmerged parallel lane (see behavior/types.ts's doc comment).
// Both are on main now, so this compile-time regression test asserts
// behavior's consumed shape stays identical to sampling's SampledRecord —
// it fails to typecheck (not a runtime assertion) if the two ever diverge
// again, e.g. if SampledRecordLike goes back to being hand-duplicated.
import { expectTypeOf, test } from "vitest";
import type { SampledRecordLike } from "../src/behavior/types.js";
import type { SampledRecord } from "../src/sampling/store.js";

test("behavior's SampledRecordLike stays identical to sampling's real SampledRecord", () => {
  expectTypeOf<SampledRecordLike>().toEqualTypeOf<SampledRecord>();
});
