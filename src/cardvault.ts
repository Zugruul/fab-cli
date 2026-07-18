const CARDVAULT_API = "https://api.cardvault.fabtcg.com/carddb/api/v1";

// The Card Vault API is open — no auth, no browser-header spoofing required
// (search and detail return 200 with no headers at all). Identify honestly.
const CV_HEADERS = {
  "User-Agent": "fab-cli (https://github.com/Zugruul/fab-cli)",
  Accept: "application/json",
};

export interface CardVaultResult {
  card_id: string;
  print_id: string;
  face_id: string;
  printed_name: string;
  printed_typebox: string;
  printed_pitch: string | null;
  printed_cost: string;
  printed_power: string;
  printed_defense: string;
  printed_rules_text: string;
  printed_flavor_text: string;
  printed_artist: string;
  languages: Record<string, string>;
}

/** Numeric stat filter: exact value on a card stat (pitch, cost, power, …). */
export interface CardVaultSearch {
  /** Free-text relevance query (matches name + text). */
  q?: string;
  /** Card name contains. */
  name?: string;
  /** Rules text contains. */
  text?: string;
  pitch?: number;
  cost?: number;
  power?: number;
  defense?: number;
  life?: number;
  intellect?: number;
  /** e.g. "Ice", "Shadow" */
  talents?: string;
  /** e.g. "Bard", "Illusionist" */
  classes?: string;
  /** e.g. "(2H)", "Aura" */
  subtype?: string;
  /** e.g. "Classic Constructed" */
  legalFormats?: string;
  /** e.g. "common", "majestic" */
  rarities?: string;
  /** e.g. "WTR", "MON" */
  setCode?: string;
  /** e.g. "Welcome to Rathe" */
  productName?: string;
  artistName?: string;
  /** ISO language code, default "en". */
  language?: string;
  pageSize?: number;
  page?: number;
}

const NUMERIC_FIELDS = ["pitch", "cost", "power", "defense", "life", "intellect"] as const;

export async function searchCardVault(search: string | CardVaultSearch): Promise<CardVaultResult[]> {
  const s: CardVaultSearch = typeof search === "string" ? { q: search } : search;
  const params = new URLSearchParams();
  if (s.q) params.set("q", s.q);
  if (s.name) params.set("name", s.name);
  if (s.text) params.set("text", s.text);
  for (const f of NUMERIC_FIELDS) {
    const v = s[f];
    if (v !== undefined) {
      params.set(`${f}_lookup`, "exact");
      params.set(f, String(v));
    }
  }
  if (s.talents) params.set("talents", s.talents);
  if (s.classes) params.set("classes", s.classes);
  if (s.subtype) params.set("subtype", s.subtype);
  if (s.legalFormats) params.set("legal_formats", s.legalFormats);
  if (s.rarities) params.set("rarities", s.rarities);
  if (s.setCode) params.set("set_code", s.setCode);
  if (s.productName) params.set("product_name", s.productName);
  if (s.artistName) params.set("artist_name", s.artistName);
  if (s.language) params.set("language", s.language);
  params.set("page_size", String(s.pageSize ?? 20));
  params.set("page", String(s.page ?? 1));
  params.set("orderby", "relevance");

  const res = await fetch(`${CARDVAULT_API}/advanced-search/?${params}`, { headers: CV_HEADERS });
  if (!res.ok) throw new Error(`Card Vault search failed: HTTP ${res.status}`);
  const data = (await res.json()) as { count: number; results: CardVaultResult[] };
  return data.results ?? [];
}

export interface CardVaultCore {
  name: string; // "slug---Display Name"
  typebox: string;
  textbox: string; // TRUE (current authoritative) text; {br} = line break, {r}/{d}/{p} icons
  pitch_value: string | null;
  cost_value: string | null;
  power_value: string | null;
  defense_value: string | null;
  life_value: string | null;
  intellect_value: string | null;
  layout_position?: number;
}

export interface CardVaultPrintFace {
  face_id: string;
  printed_name: string;
  printed_typebox: string;
  printed_rules_text: string;
  printed_flavor_text: string;
  printed_defense: string;
}

export interface CardVaultPrint {
  print_id: string;
  rarity: string;
  is_default: boolean;
  print_language: string;
  print_set?: { set_code: string; set_name: string };
  faces: CardVaultPrintFace[];
}

export interface CardVaultCard {
  card_id: string;
  card_type: string;
  object_type: string;
  cores: CardVaultCore[];
  card_prints: CardVaultPrint[];
  card_legality: Record<string, { legality: string; reason?: string }>;
  rulings_errata: unknown[];
}

/**
 * Fetch a card's full Card Vault record by card_id (slug from search results).
 * `cores[].textbox` is the TRUE text — the current authoritative wording per CR 2.0.2.
 * Note the literal `card_id/` path segment and required trailing slash.
 */
export async function fetchCardVaultCard(cardId: string): Promise<CardVaultCard | null> {
  const res = await fetch(`${CARDVAULT_API}/card_id/${encodeURIComponent(cardId)}/`, {
    headers: CV_HEADERS,
  });
  if (!res.ok) throw new Error(`Card Vault detail failed: HTTP ${res.status}`);
  const data = (await res.json()) as { count: number; results: CardVaultCard[] };
  return data.results?.[0] ?? null;
}

/** Render a Card Vault textbox ({br} separators) as plain multi-line text. */
export function renderTextbox(textbox: string): string {
  return textbox.split("{br}").join("\n");
}

/** A single Card Vault ruling/errata entry, defensively normalized. */
export interface CardRuling {
  date: string | null;
  text: string;
  raw?: unknown;
}

const RULING_DATE_KEYS = ["date", "ruling_date", "created_at"] as const;
const RULING_TEXT_KEYS = ["text", "ruling_text", "description", "body"] as const;

/**
 * Normalizes one `rulings_errata` entry into a CardRuling, trying a few
 * candidate key names since the live API's real entry shape is unconfirmed.
 * Falls back to stringifying the whole entry rather than throwing on an
 * unrecognized shape.
 */
export function parseCardRuling(entry: unknown): CardRuling {
  if (entry !== null && typeof entry === "object") {
    const obj = entry as Record<string, unknown>;
    const textKey = RULING_TEXT_KEYS.find((k) => typeof obj[k] === "string");
    if (textKey) {
      const dateKey = RULING_DATE_KEYS.find((k) => typeof obj[k] === "string");
      return {
        date: dateKey ? (obj[dateKey] as string) : null,
        text: obj[textKey] as string,
        raw: entry,
      };
    }
  }
  return { date: null, text: String(entry), raw: entry };
}

/** Stable sort: most-recent-first where both dates are parseable, original order otherwise. */
function compareRulingsByDate(a: CardRuling, b: CardRuling): number {
  const ta = a.date ? Date.parse(a.date) : NaN;
  const tb = b.date ? Date.parse(b.date) : NaN;
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return tb - ta;
}

/**
 * Resolves `cardName` to a Card Vault card and returns its rulings.
 * Returns `null` when there is no Card Vault match at all, or on any
 * network/HTTP error — distinct from `[]`, which means the card was found
 * but has zero official rulings.
 */
export async function fetchCardRulings(
  cardName: string,
): Promise<CardRuling[] | null> {
  try {
    const results = await searchCardVault({ name: cardName });
    const top = results[0];
    if (!top) return null;
    const card = await fetchCardVaultCard(top.card_id);
    if (!card) return null;
    return card.rulings_errata.map(parseCardRuling).sort(compareRulingsByDate);
  } catch {
    return null;
  }
}
