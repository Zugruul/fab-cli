import { describe, expect, it } from "vitest";
import {
  slugifyCardName,
  detectDatasetGap,
  parseExistingStatus,
  shouldResumeDossier,
  formatDossier,
  type DossierInput,
} from "../src/talisharDossier";

describe("slugifyCardName", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slugifyCardName("Snatch")).toBe("snatch");
    expect(slugifyCardName("Fyendal's Spring Tunic")).toBe(
      "fyendals-spring-tunic",
    );
  });

  it("collapses repeated whitespace/punctuation into a single hyphen", () => {
    expect(slugifyCardName("Rip   Tide!!")).toBe("rip-tide");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugifyCardName("  -Snatch- ")).toBe("snatch");
  });
});

describe("detectDatasetGap", () => {
  it("reports a gap when the-fab-cube search returns no matches", () => {
    expect(detectDatasetGap([])).toBe(true);
  });

  it("reports no gap when at least one match is found", () => {
    expect(detectDatasetGap([{ name: "Snatch" }])).toBe(false);
  });
});

describe("parseExistingStatus", () => {
  it("returns null when there is no existing dossier", () => {
    expect(parseExistingStatus(null)).toBeNull();
  });

  it("extracts the Status section's value", () => {
    const content = `# Dossier: Snatch (WTR167)\n\n## Status\ndossier\n\n## Card Vault true text\n...\n`;
    expect(parseExistingStatus(content)).toBe("dossier");
  });

  it("extracts a blocked status with its reason intact", () => {
    const content = `# Dossier: Foo\n\n## Status\nblocked: awaiting dataset regen\n\n## Card Vault true text\n...\n`;
    expect(parseExistingStatus(content)).toBe(
      "blocked: awaiting dataset regen",
    );
  });

  it("returns null when the file has no Status section", () => {
    expect(
      parseExistingStatus("# Dossier: Foo\n\nno status here\n"),
    ).toBeNull();
  });
});

describe("shouldResumeDossier", () => {
  it("resumes a fresh dossier-phase file", () => {
    expect(shouldResumeDossier("dossier")).toBe(true);
  });

  it("does not resume when no dossier exists yet", () => {
    expect(shouldResumeDossier(null)).toBe(false);
  });

  it("does not resume a dossier that has moved to a later phase", () => {
    expect(shouldResumeDossier("implementing")).toBe(false);
    expect(shouldResumeDossier("images")).toBe(false);
    expect(shouldResumeDossier("validating")).toBe(false);
    expect(shouldResumeDossier("ready-for-pr")).toBe(false);
  });

  it("does not resume a blocked dossier", () => {
    expect(shouldResumeDossier("blocked: awaiting dataset regen")).toBe(false);
  });
});

describe("formatDossier", () => {
  const baseInput: DossierInput = {
    cardName: "Snatch",
    setCode: "WTR167",
    cardVaultText: "When this hits, draw a card.",
    cardVaultUrl: "https://cardvault.fabtcg.com/card/snatch-1/",
    rulings: [],
    stats: { found: true, block: "pitch 1 · cost 0 · power 4 · defense 2" },
    fabraryContext:
      "Generic pitch-1/2/3 attack action reprinted across multiple sets; no notable meta signal beyond ubiquity as a cantrip attack.",
    similarImplementations: [
      {
        note: "tal-recipe-base-card",
        reason:
          'contains the exact on-hit TRIGGER->ProcessTrigger draw-a-card branch (case "Draw_a_Card": Draw($this->controller);) that Snatch\'s single-mode hit trigger needs, even though the full skeleton also carries an unrelated modal gate.',
      },
    ],
    imageReference: "https://cardvault.fabtcg.com/card/snatch-1/",
  };

  it("includes the title, set code, and all required sections in order", () => {
    const md = formatDossier(baseInput);
    expect(md).toContain("# Dossier: Snatch (WTR167)");
    const sectionOrder = [
      "## Status",
      "## Card Vault true text",
      "## Rulings / errata",
      "## the-fab-cube stats",
      "## Fabrary context",
      "## Similar existing implementation(s)",
      "## Official image reference",
    ];
    let cursor = -1;
    for (const heading of sectionOrder) {
      const idx = md.indexOf(heading);
      expect(idx).toBeGreaterThan(cursor);
      cursor = idx;
    }
  });

  it("defaults Status to dossier", () => {
    const md = formatDossier(baseInput);
    expect(md).toMatch(/## Status\ndossier/);
  });

  it("renders the verbatim Card Vault true text plus URL", () => {
    const md = formatDossier(baseInput);
    expect(md).toContain("When this hits, draw a card.");
    expect(md).toContain("https://cardvault.fabtcg.com/card/snatch-1/");
  });

  it("renders 'no official rulings' when the rulings array is empty", () => {
    const md = formatDossier(baseInput);
    expect(md).toContain("no official rulings");
  });

  it("renders each ruling entry when present", () => {
    const md = formatDossier({
      ...baseInput,
      rulings: [{ date: "2020-01-01", text: "Some ruling text." }],
    });
    expect(md).toContain("2020-01-01");
    expect(md).toContain("Some ruling text.");
  });

  it("renders the stats block when the card is in the dataset", () => {
    const md = formatDossier(baseInput);
    expect(md).toContain("pitch 1 · cost 0 · power 4 · defense 2");
    expect(md).not.toContain("GAP: not yet in dataset");
  });

  it("renders the dataset-gap message and Dataset gap section when the card isn't in the dataset yet", () => {
    const md = formatDossier({
      ...baseInput,
      stats: { found: false },
    });
    expect(md).toContain("GAP: not yet in dataset");
    expect(md).toContain("## Dataset gap");
    expect(md).toContain("zzCardCodeGenerator.php");
  });

  it("omits the Dataset gap section when the card is in the dataset", () => {
    const md = formatDossier(baseInput);
    expect(md).not.toContain("## Dataset gap");
  });

  it("cites each similar implementation with its note name and reason", () => {
    const md = formatDossier(baseInput);
    expect(md).toContain("tal-recipe-base-card");
    expect(md).toContain("on-hit TRIGGER->ProcessTrigger draw-a-card branch");
  });

  it("records when brain recall found no matching pattern instead of silently omitting the section", () => {
    const md = formatDossier({ ...baseInput, similarImplementations: [] });
    expect(md).toContain("## Similar existing implementation(s)");
    expect(md).toContain("no matching pattern found via brain recall");
  });

  it("renders 'no notable usage data' when Fabrary context is empty", () => {
    const md = formatDossier({ ...baseInput, fabraryContext: null });
    expect(md).toContain("no notable usage data");
  });
});
