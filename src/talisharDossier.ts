/**
 * Pure dossier-assembly logic for /talishar-implement-card's phase 1 (dossier).
 * See docs/design/talishar-E2.md for the file shape this formats and the
 * resume/gap-detection rules this implements. No network/live tool calls here —
 * callers (the skill's own Steps) supply already-fetched data.
 */

export interface DossierRuling {
  date: string;
  text: string;
}

export interface DossierStats {
  found: boolean;
  /** Rendered stats block text; required when found is true. */
  block?: string;
}

export interface SimilarImplementation {
  /** talishar-brain note name, e.g. "tal-recipe-base-card" */
  note: string;
  /** why this note is the closest pattern match */
  reason: string;
}

export interface DossierInput {
  cardName: string;
  setCode?: string;
  status?: string;
  cardVaultText: string;
  cardVaultUrl: string;
  rulings: DossierRuling[];
  stats: DossierStats;
  fabraryContext: string | null;
  similarImplementations: SimilarImplementation[];
  imageReference: string;
}

export function slugifyCardName(name: string): string {
  return name
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function detectDatasetGap(matches: unknown[]): boolean {
  return matches.length === 0;
}

const STATUS_RE = /^## Status\n(.+)$/m;

export function parseExistingStatus(content: string | null): string | null {
  if (content === null) return null;
  const match = content.match(STATUS_RE);
  return match ? match[1].trim() : null;
}

export function shouldResumeDossier(status: string | null): boolean {
  return status === "dossier";
}

function formatRulings(rulings: DossierRuling[]): string {
  if (rulings.length === 0) return "no official rulings";
  return rulings.map((r) => `- ${r.date}: ${r.text}`).join("\n");
}

function formatStats(stats: DossierStats): string {
  if (!stats.found)
    return "GAP: not yet in dataset — see Dataset gap section below.";
  return stats.block ?? "";
}

function formatSimilarImplementations(items: SimilarImplementation[]): string {
  if (items.length === 0) {
    return "no matching pattern found via brain recall — fell back to grepping the vendored engine directly (record what, if anything, was found).";
  }
  return items.map((i) => `- \`${i.note}\` — ${i.reason}`).join("\n");
}

export function formatDossier(input: DossierInput): string {
  const title = input.setCode
    ? `${input.cardName} (${input.setCode})`
    : input.cardName;
  const status = input.status ?? "dossier";
  const fabraryContext = input.fabraryContext ?? "no notable usage data";

  const sections = [
    `# Dossier: ${title}`,
    `## Status\n${status}`,
    `## Card Vault true text\n${input.cardVaultText}\n\n${input.cardVaultUrl}`,
    `## Rulings / errata\n${formatRulings(input.rulings)}`,
    `## the-fab-cube stats\n${formatStats(input.stats)}`,
    `## Fabrary context\n${fabraryContext}`,
    `## Similar existing implementation(s)\n${formatSimilarImplementations(input.similarImplementations)}`,
    `## Official image reference\n${input.imageReference}`,
  ];

  if (!input.stats.found) {
    sections.push(
      `## Dataset gap\n` +
        `\`${input.cardName}\` is not yet in \`third_party/flesh-and-blood-cards\`. Stats above were ` +
        `derived from Card Vault/spoilers instead. \`zzCardCodeGenerator.php\` output needs ` +
        `regeneration once the dataset catches up — do not proceed to implementation stats until ` +
        `then, or flag this gap explicitly to whoever picks up TAL-021.`,
    );
  }

  return sections.join("\n\n") + "\n";
}
