import * as fs from "fs";
import * as path from "path";

/**
 * Offline card search over the vendored the-fab-cube/flesh-and-blood-cards
 * submodule (third_party/flesh-and-blood-cards). No auth, no network.
 * True-text authority remains cardvault.fabtcg.com (CR 2.0.2); the submodule's
 * banned-*.json files may be stale — card legality is always the live policy page.
 */

const REPO_ROOT = path.resolve(__dirname, "..");
export const CARD_DB_PATH = path.join(
  REPO_ROOT,
  "third_party",
  "flesh-and-blood-cards",
  "json",
  "english",
  "card.json"
);

export interface LocalCard {
  name: string;
  pitch?: string;
  cost?: string;
  power?: string;
  defense?: string;
  health?: string;
  intelligence?: string;
  types: string[];
  card_keywords?: string[];
  granted_keywords?: string[];
  ability_and_effect_keywords?: string[];
  functional_text?: string;
  rarities?: string[];
  printings?: unknown[];
  [key: string]: unknown;
}

export interface LocalSearchOptions {
  /** search scope: name, text, keyword, or any (name+text) */
  scope?: "name" | "text" | "keyword" | "any";
  /** exact (case-insensitive) name match — overrides terms/scope */
  exact?: string;
  pitch?: string;
  cost?: string;
  type?: string;
  class?: string;
  limit?: number;
}

let cache: LocalCard[] | null = null;

export function loadCardDb(): LocalCard[] {
  if (cache) return cache;
  if (!fs.existsSync(CARD_DB_PATH)) {
    throw new Error(
      `card DB missing: ${CARD_DB_PATH}\nrun: git submodule update --init third_party/flesh-and-blood-cards`
    );
  }
  cache = JSON.parse(fs.readFileSync(CARD_DB_PATH, "utf-8")) as LocalCard[];
  return cache;
}

export function searchLocalCards(terms: string[], opts: LocalSearchOptions = {}): LocalCard[] {
  const cards = loadCardDb();
  if (opts.exact !== undefined) {
    const want = opts.exact.toLowerCase();
    return cards.filter((c) => c.name.toLowerCase() === want);
  }
  const scope = opts.scope ?? "any";
  const lowered = terms.map((t) => t.toLowerCase());
  return cards.filter((c) => {
    const name = c.name.toLowerCase();
    const text = (c.functional_text ?? "").toLowerCase();
    const kws = [
      ...(c.card_keywords ?? []),
      ...(c.granted_keywords ?? []),
      ...(c.ability_and_effect_keywords ?? []),
    ]
      .join(" ")
      .toLowerCase();
    const hay =
      scope === "name" ? name : scope === "text" ? text : scope === "keyword" ? kws : `${name} ${text}`;
    if (lowered.length > 0 && !lowered.every((t) => hay.includes(t))) return false;
    if (opts.pitch !== undefined && String(c.pitch ?? "") !== opts.pitch) return false;
    if (opts.cost !== undefined && String(c.cost ?? "") !== opts.cost) return false;
    if (opts.type !== undefined && !c.types.some((t) => t.toLowerCase() === opts.type!.toLowerCase()))
      return false;
    if (opts.class !== undefined && !c.types.some((t) => t.toLowerCase() === opts.class!.toLowerCase()))
      return false;
    return true;
  });
}
