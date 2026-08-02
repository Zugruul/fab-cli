import { deriveAppReadiness } from "../readiness";

// §9.9 degraded-mode navigation truth table: catalog CRUD is always usable
// model-free; Q&A needs both packs; scanning needs only the model pack
// (§11.5 loads detector+embedder from the model pack, not the knowledge
// pack). Every unavailable feature must carry a specific, honest reason —
// never a bare `available: false` with no explanation (§9.9 "rather than
// errors").

describe("deriveAppReadiness (§9.9 degraded-mode navigation truth table)", () => {
  it("nothing installed: catalog usable, Q&A and scanning both not-ready with distinct reasons", () => {
    const readiness = deriveAppReadiness({ modelPack: "not-installed", knowledgePack: "not-installed", tier: null });

    expect(readiness.catalog).toEqual({ available: true });
    expect(readiness.qa.available).toBe(false);
    expect(readiness.qa.reason).toBeTruthy();
    expect(readiness.scanning.available).toBe(false);
    expect(readiness.scanning.reason).toBeTruthy();
  });

  it("knowledge pack only: catalog usable, scanning still not-ready (no model), Q&A not-ready (no model)", () => {
    const readiness = deriveAppReadiness({ modelPack: "not-installed", knowledgePack: "installed", tier: null });

    expect(readiness.catalog).toEqual({ available: true });
    expect(readiness.scanning.available).toBe(false);
    expect(readiness.scanning.reason).toMatch(/model pack/i);
    expect(readiness.qa.available).toBe(false);
    expect(readiness.qa.reason).toMatch(/model pack/i);
  });

  it("model pack only: catalog usable, scanning usable, Q&A not-ready (no knowledge pack)", () => {
    const readiness = deriveAppReadiness({ modelPack: "installed", knowledgePack: "not-installed", tier: "0.6B" });

    expect(readiness.catalog).toEqual({ available: true });
    expect(readiness.scanning).toEqual({ available: true });
    expect(readiness.qa.available).toBe(false);
    expect(readiness.qa.reason).toMatch(/knowledge pack/i);
  });

  it("both installed: every feature usable, with no reason attached to the available cases", () => {
    const readiness = deriveAppReadiness({ modelPack: "installed", knowledgePack: "installed", tier: "1.7B" });

    expect(readiness.catalog).toEqual({ available: true });
    expect(readiness.scanning).toEqual({ available: true });
    expect(readiness.qa).toEqual({ available: true });
  });

  it("the nothing-installed Q&A reason is distinct from the single-artifact-missing reasons", () => {
    const nothing = deriveAppReadiness({ modelPack: "not-installed", knowledgePack: "not-installed", tier: null });
    const modelOnly = deriveAppReadiness({ modelPack: "installed", knowledgePack: "not-installed", tier: "0.6B" });
    const knowledgeOnly = deriveAppReadiness({ modelPack: "not-installed", knowledgePack: "installed", tier: null });

    const reasons = new Set([nothing.qa.reason, modelOnly.qa.reason, knowledgeOnly.qa.reason]);
    expect(reasons.size).toBe(3);
  });
});
