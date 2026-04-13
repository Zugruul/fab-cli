const EVENTS_URL = "https://fabtcg.com/organised-play/";
const COVERAGE_BASE = "https://fabtcg.com/coverage";
const WP_API = "https://fabtcg.com/api/wp/v2";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://fabtcg.com/",
};

const JSON_HEADERS = { ...BROWSER_HEADERS, Accept: "application/json" };

export interface TournamentEvent {
  name: string;
  date: string;       // ISO-like string from the page
  location: string;
  format: string | null;
  url: string;
  tier: string | null; // "Pro Tour", "Calling", "World Championship", etc.
}

// Tier keywords to detect from event name/title
const MAJOR_TIERS = [
  "Pro Tour",
  "World Championship",
  "Calling",
  "Road to Nationals",
  "National Championship",
  "Skirmish",
  "Battle Hardened",
  "Armory",
];

function detectTier(text: string): string | null {
  for (const tier of MAJOR_TIERS) {
    if (text.toLowerCase().includes(tier.toLowerCase())) return tier;
  }
  return null;
}

function isWorldTour(event: TournamentEvent): boolean {
  const worldTourTiers = ["Pro Tour", "World Championship", "Calling"];
  return worldTourTiers.some(
    (t) => event.tier === t || (event.name.toLowerCase().includes(t.toLowerCase()))
  );
}

export async function fetchEvents(filters?: {
  worldTour?: boolean;
  upcoming?: boolean;
  format?: string;
}): Promise<TournamentEvent[]> {
  const res = await fetch(EVENTS_URL, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`Failed to fetch events: ${res.status} ${res.statusText}`);
  const html = await res.text();

  const events = parseEventsHtml(html);

  let filtered = events;

  if (filters?.upcoming) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    filtered = filtered.filter((e) => {
      const d = parseEventDate(e.date);
      return d === null || d >= today;
    });
  }

  if (filters?.worldTour) {
    filtered = filtered.filter(isWorldTour);
  }

  if (filters?.format) {
    const fmt = filters.format.toLowerCase();
    filtered = filtered.filter(
      (e) => e.format && e.format.toLowerCase().includes(fmt)
    );
  }

  return filtered;
}

function parseEventDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  // Normalize "Month D1-D2, YYYY" → "Month D1, YYYY" to avoid JS parsing "D2" as year
  const normalized = dateStr.replace(/^(\w+ \d+)-\d+(,\s*\d{4})/, "$1$2");
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&#8216;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseEventsHtml(html: string): TournamentEvent[] {
  // fabtcg.com uses <a class="fl-link-card-ssr" href="...">
  //   <div class="fl-link-card-ssr-content">
  //     <h3>Event Name</h3>
  //     <p>Apr 3-5, 2026 / Location</p>
  //   </div>
  // </a>
  const events = parseFabtcgCards(html);
  if (events.length > 0) return events;

  // Fallback: JSON-LD structured data
  const jsonLdEvents = parseJsonLd(html);
  if (jsonLdEvents.length > 0) return jsonLdEvents;

  // Fallback: generic link extraction
  return parseEventLinks(html);
}

function parseFabtcgCards(html: string): TournamentEvent[] {
  const events: TournamentEvent[] = [];

  // Match each <a class="fl-link-card-ssr" href="...">...</a> block
  const cardRe = /<a\b([^>]*class="[^"]*fl-link-card-ssr[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(cardRe)) {
    const attrs = match[1];
    const body  = match[2];

    const hrefMatch = attrs.match(/href="([^"]+)"/);
    const url = hrefMatch ? resolveUrl(hrefMatch[1]) : EVENTS_URL;

    const h3Match = body.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    const name = h3Match ? stripHtml(h3Match[1]) : "";
    if (!name) continue;

    // <p>Apr 3-5, 2026 / Location</p>
    const pMatch = body.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const pText = pMatch ? stripHtml(pMatch[1]) : "";

    // Split on " / " to get date and location
    const slashIdx = pText.indexOf(" / ");
    const dateStr  = slashIdx >= 0 ? pText.slice(0, slashIdx).trim() : pText;
    const location = slashIdx >= 0 ? pText.slice(slashIdx + 3).trim() : "";

    // Skip informational cards that don't have a date
    if (!dateStr || !/\d{4}/.test(dateStr)) continue;

    events.push({
      name,
      date: dateStr,
      location,
      format: null,
      url,
      tier: detectTier(name),
    });
  }

  return events;
}

function parseJsonLd(html: string): TournamentEvent[] {
  const events: TournamentEvent[] = [];
  for (const match of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    try {
      const data = JSON.parse(match[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item["@type"] === "Event" || item["@type"] === "SportsEvent") {
          const name = stripHtml(String(item.name ?? ""));
          const date = String(item.startDate ?? item.date ?? "");
          const location =
            item.location?.name ??
            item.location?.address?.addressLocality ??
            (typeof item.location === "string" ? item.location : "") ??
            "";
          const url = String(item.url ?? EVENTS_URL);
          events.push({ name, date, location: stripHtml(String(location)), format: null, url, tier: detectTier(name) });
        }
      }
    } catch { /* ignore */ }
  }
  return events;
}

function parseEventLinks(html: string): TournamentEvent[] {
  const events: TournamentEvent[] = [];
  const seen = new Set<string>();
  const linkRe =
    /<a[^>]*href=["']([^"']*(?:event|tournament|calling|pro-tour)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(linkRe)) {
    const url = resolveUrl(match[1]);
    if (seen.has(url)) continue;
    seen.add(url);
    const name = stripHtml(match[2]);
    if (!name || name.length < 3) continue;
    events.push({ name, date: "", location: "", format: null, url, tier: detectTier(name) });
  }
  return events;
}

function resolveUrl(href: string): string {
  if (href.startsWith("http")) return href;
  if (href.startsWith("/")) return `https://fabtcg.com${href}`;
  return `https://fabtcg.com/${href}`;
}

// ─── tournament coverage ──────────────────────────────────────────────────────

export interface TournamentInfo {
  id: number;
  slug: string;
  title: string;
}

export interface StandingsRow {
  rank: number;
  player: string;
  hero: string;
  wins: number;
}

export interface CoverageIndex {
  slug: string;
  title: string;
  standingRounds: number[];
  resultRounds: number[];
  hasFinalStandings: boolean;
}

export interface DecklistMeta {
  slug: string;
  url: string;
  player: string;
  hero: string;
  event: string;
  format: string | null;
}

export interface DeckCard {
  quantity: number;
  name: string;
  pitch: number | null; // null = equipment/no pitch
}

export interface PlayerDecklist extends DecklistMeta {
  equipment: DeckCard[];
  mainDeck: DeckCard[];
  fabraryDeckId?: string; // set after cross-referencing Fabrary
}

/** Convert a fabtcg.com hero display name to a Fabrary/Algolia slug identifier.
 *  e.g. "Oscilio, Constella Intelligence" → "oscilio-constella-intelligence"
 */
export function heroNameToIdentifier(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")   // strip commas, apostrophes, etc.
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── WP API ──────────────────────────────────────────────────────────────────

export async function searchTournament(name: string): Promise<TournamentInfo[]> {
  const url = `${WP_API}/tournament?search=${encodeURIComponent(name)}&per_page=10`;
  const res = await fetch(url, { headers: JSON_HEADERS });
  if (!res.ok) throw new Error(`Tournament search failed: ${res.status}`);
  const data = await res.json() as Array<{ id: number; slug: string; title: { rendered: string } }>;
  return data.map((t) => ({
    id: t.id,
    slug: t.slug,
    title: stripHtml(t.title.rendered),
  }));
}

export async function searchTournamentDecklists(
  eventSlug: string,
  playerName?: string
): Promise<DecklistMeta[]> {
  // WP API searches titles/content — use space-separated keywords from the slug
  const slugWords = eventSlug.replace(/-/g, " ");
  const q = playerName ? `${playerName} ${slugWords}` : slugWords;
  const url = `${WP_API}/decklist?search=${encodeURIComponent(q)}&per_page=100`;
  const res = await fetch(url, { headers: JSON_HEADERS });
  if (!res.ok) return [];
  const data = await res.json() as Array<{
    slug: string;
    link: string;
    cmb2: { decklist_auto_fields: { decklist_hero?: string; decklist_player_name?: string; decklist_event_name?: string } };
  }>;

  return data
    .filter((d) => d.slug.includes(eventSlug))
    .map((d) => {
      const f = d.cmb2?.decklist_auto_fields ?? {};
      return {
        slug: d.slug,
        url: d.link,
        player: f.decklist_player_name ?? "",
        hero: f.decklist_hero ?? "",
        event: f.decklist_event_name ?? "",
        format: null,
      };
    });
}

// ─── coverage index ──────────────────────────────────────────────────────────

export async function fetchCoverageIndex(slug: string): Promise<CoverageIndex> {
  const res = await fetch(`${COVERAGE_BASE}/${slug}/`, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`Coverage page not found for "${slug}" (${res.status})`);
  const html = await res.text();

  const standingRounds = [...new Set(
    [...html.matchAll(/\/standings\/(\d+)\//g)].map((m) => parseInt(m[1]))
  )].sort((a, b) => a - b);

  const resultRounds = [...new Set(
    [...html.matchAll(/\/results\/(\d+)\//g)].map((m) => parseInt(m[1]))
  )].sort((a, b) => a - b);

  const hasFinalStandings = /\/final-standings\//.test(html);

  // Try to get a title from the page
  // Prefer entry-title h1, fall back to <title> minus site name
  const h1Match = html.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const title = h1Match
    ? stripHtml(h1Match[1]).trim()
    : titleMatch
      ? stripHtml(titleMatch[1]).replace(/\s*[|\-–]\s*Flesh and Blood TCG.*$/i, "").trim() || slug
      : slug;

  return { slug, title, standingRounds, resultRounds, hasFinalStandings };
}

// ─── standings ───────────────────────────────────────────────────────────────

export async function fetchStandings(
  slug: string,
  round: number | "final"
): Promise<StandingsRow[]> {
  const path = round === "final"
    ? `${COVERAGE_BASE}/${slug}/final-standings/`
    : `${COVERAGE_BASE}/${slug}/standings/${round}/`;

  const res = await fetch(path, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`Standings fetch failed: ${res.status} (${path})`);
  const html = await res.text();

  const rows: StandingsRow[] = [];
  for (const tr of html.matchAll(/<tr[^>]*>(.*?)<\/tr>/gis)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>(.*?)<\/td>/gis)]
      .map((c) => stripHtml(c[1]));
    if (cells.length < 3) continue;
    rows.push({
      rank: parseInt(cells[0]) || rows.length + 1,
      player: cells[1],
      hero: cells[2],
      wins: parseInt(cells[3]) || 0,
    });
  }
  return rows;
}

// ─── round pairings / player path ────────────────────────────────────────────

export interface RoundPairing {
  round: number;
  player1: string;
  player1Hero: string | null;
  player2: string;
  player2Hero: string | null;
  winner: 1 | 2 | null; // 1 = player1 wins, 2 = player2 wins, null = draw/unknown
  isBye: boolean;
}

export interface PlayerRoundResult {
  round: number;
  format: string;
  playerHero: string | null;  // what the tracked player was playing this round
  opponent: string;
  opponentHero: string | null;
  result: "W" | "L" | "D" | "Bye";
}

export interface PlayerPath {
  player: string;
  heroByFormat: Record<string, string>;  // format → hero (e.g. "Classic Constructed" → "Teklovossen…")
  event: string;
  rounds: PlayerRoundResult[];
  wins: number;
  losses: number;
  draws: number;
  byes: number;
  byFormat: Array<{ format: string; wins: number; losses: number; draws: number }>;
}

/** Extract player name and hero from a player-cell td block.
 *  Structure: <div class="player-text"><strong><i class="flag xx"></i> Name</strong><br/><span>Hero Name</span></div>
 */
function extractPlayerCell(cell: string): { name: string; hero: string | null } {
  const textDiv = cell.match(/<div[^>]*class="[^"]*player-text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const content = textDiv?.[1] ?? cell;
  const strongMatch = content.match(/<strong>([\s\S]*?)<\/strong>/i);
  const name = strongMatch ? stripHtml(strongMatch[1]).trim() : "";
  const spanMatch = content.match(/<span[^>]*>([^<]+)<\/span>/i);
  const hero = spanMatch ? spanMatch[1].trim() || null : null;
  return { name, hero };
}

/** Fetch pairings for a single results round from the coverage pages. */
export async function fetchRoundPairings(slug: string, round: number): Promise<RoundPairing[]> {
  const url = `${COVERAGE_BASE}/${slug}/results/${round}/`;
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) return [];
  const html = await res.text();

  const pairings: RoundPairing[] = [];

  // Split on <tr class="match-row"> blocks
  const blocks = html.split('<tr class="match-row">');
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];

    // Extract player-1-cell and player-2-cell
    const p1Cell = block.match(/<td[^>]*class="[^"]*player-1-cell[^"]*"[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "";
    const p2Cell = block.match(/<td[^>]*class="[^"]*player-2-cell[^"]*"[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "";

    const p1 = extractPlayerCell(p1Cell);
    const p2 = extractPlayerCell(p2Cell);

    if (!p1.name) continue;

    const isBye = !p2.name || /\bbye\b/i.test(block);

    // Winner-pill says "Player 1 Win" or "Player 2 Win"
    const winnerPill = block.match(/<span[^>]*class="[^"]*winner-pill[^"]*"[^>]*>([^<]+)<\/span>/i)?.[1] ?? "";
    let winner: 1 | 2 | null = null;
    if (/player.?1/i.test(winnerPill)) winner = 1;
    else if (/player.?2/i.test(winnerPill)) winner = 2;

    pairings.push({
      round,
      player1: p1.name,
      player1Hero: p1.hero,
      player2: p2.name || "BYE",
      player2Hero: p2.hero,
      winner,
      isBye,
    });
  }

  return pairings;
}

/** Search for players in an event by partial name match, using round 1 pairings. */
export async function searchPlayerInEvent(
  slug: string,
  query: string
): Promise<Array<{ name: string; hero: string | null }>> {
  // Round 1 has every registered player — single fetch is enough
  const pairings = await fetchRoundPairings(slug, 1);
  const lower = query.toLowerCase();
  const results: Array<{ name: string; hero: string | null }> = [];
  const seen = new Set<string>();
  for (const p of pairings) {
    for (const [name, hero] of [[p.player1, p.player1Hero], [p.player2, p.player2Hero]] as [string, string | null][]) {
      if (name && name !== "BYE" && name.toLowerCase().includes(lower) && !seen.has(name)) {
        seen.add(name);
        results.push({ name, hero });
      }
    }
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/** Parse the coverage index page for "Round N - Format" schedule entries. */
export async function fetchFormatSchedule(slug: string): Promise<Map<number, string>> {
  const schedule = new Map<number, string>();
  const res = await fetch(`${COVERAGE_BASE}/${slug}/`, { headers: BROWSER_HEADERS });
  if (!res.ok) return schedule;
  const html = await res.text();

  // Match "Round N - Format Name" patterns (the coverage article body lists these)
  const roundRe = /[Rr]ound\s+(\d+)\s*[-–]\s*([^\n<]{3,40})/g;
  for (const m of html.matchAll(roundRe)) {
    const roundNum = parseInt(m[1]);
    const fmt = stripHtml(m[2]).replace(/\s*\(.*\)/, "").trim();
    if (fmt && roundNum > 0) {
      schedule.set(roundNum, fmt);
    }
  }

  return schedule;
}

/** Reconstruct a player's full round-by-round path through a tournament. */
export async function fetchPlayerPath(
  slug: string,
  playerName: string
): Promise<PlayerPath | null> {
  const lowerName = playerName.toLowerCase();

  // Fetch coverage index and format schedule in parallel
  const [idx, formatSchedule] = await Promise.all([
    fetchCoverageIndex(slug),
    fetchFormatSchedule(slug),
  ]);

  // Fetch all result rounds in parallel (hero data comes from pairings directly)
  const allPairings = await Promise.all(
    idx.resultRounds.map((r) => fetchRoundPairings(slug, r))
  );

  // Resolve the exact player name from pairings (partial match)
  let exactPlayerName = playerName;
  outer: for (const roundPairings of allPairings) {
    for (const p of roundPairings) {
      if (p.player1.toLowerCase().includes(lowerName)) { exactPlayerName = p.player1; break outer; }
      if (p.player2.toLowerCase().includes(lowerName)) { exactPlayerName = p.player2; break outer; }
    }
  }

  // No longer needed — hero is tracked per-round below

  const rounds: PlayerRoundResult[] = [];

  for (let ri = 0; ri < idx.resultRounds.length; ri++) {
    const roundNum = idx.resultRounds[ri];
    const roundPairings = allPairings[ri];

    const pairing = roundPairings.find(
      (p) =>
        p.player1.toLowerCase().includes(lowerName) ||
        p.player2.toLowerCase().includes(lowerName)
    );
    if (!pairing) continue;

    const isPlayer1 = pairing.player1.toLowerCase().includes(lowerName);
    const playerHero = isPlayer1 ? pairing.player1Hero : pairing.player2Hero;
    const opponent = isPlayer1 ? pairing.player2 : pairing.player1;
    const opponentHero = isPlayer1 ? pairing.player2Hero : pairing.player1Hero;

    let result: "W" | "L" | "D" | "Bye";
    if (pairing.isBye) {
      result = "Bye";
    } else if (pairing.winner === null) {
      result = "D";
    } else {
      // winner is 1 or 2 (player number)
      result = (isPlayer1 ? pairing.winner === 1 : pairing.winner === 2) ? "W" : "L";
    }

    const format = formatSchedule.get(roundNum) ?? (roundNum > (idx.resultRounds[idx.resultRounds.length - 4] ?? 999) ? "Top 8" : `Round ${roundNum}`);

    rounds.push({ round: roundNum, format, playerHero, opponent, opponentHero, result });
  }

  if (rounds.length === 0) return null;

  // Aggregate by format
  const formatMap = new Map<string, { wins: number; losses: number; draws: number }>();
  for (const r of rounds) {
    if (!formatMap.has(r.format)) formatMap.set(r.format, { wins: 0, losses: 0, draws: 0 });
    const s = formatMap.get(r.format)!;
    if (r.result === "W") s.wins++;
    else if (r.result === "L") s.losses++;
    else if (r.result === "D") s.draws++;
  }

  // Build heroByFormat: first non-null hero seen for each format
  const heroByFormat: Record<string, string> = {};
  for (const r of rounds) {
    if (r.playerHero && !(r.format in heroByFormat)) {
      heroByFormat[r.format] = r.playerHero;
    }
  }

  return {
    player: exactPlayerName,
    heroByFormat,
    event: idx.title,
    rounds,
    wins: rounds.filter((r) => r.result === "W").length,
    losses: rounds.filter((r) => r.result === "L").length,
    draws: rounds.filter((r) => r.result === "D").length,
    byes: rounds.filter((r) => r.result === "Bye").length,
    byFormat: [...formatMap.entries()].map(([format, s]) => ({ format, wins: s.wins, losses: s.losses, draws: s.draws })),
  };
}

// ─── decklist parsing ─────────────────────────────────────────────────────────

export async function fetchDecklistCards(decklistSlug: string): Promise<PlayerDecklist | null> {
  // Get metadata from WP API
  const apiUrl = `${WP_API}/decklist?slug=${encodeURIComponent(decklistSlug)}`;
  const apiRes = await fetch(apiUrl, { headers: JSON_HEADERS });
  let meta: DecklistMeta | null = null;
  if (apiRes.ok) {
    const data = await apiRes.json() as Array<{
      slug: string; link: string;
      cmb2: { decklist_auto_fields: { decklist_hero?: string; decklist_player_name?: string; decklist_event_name?: string } };
    }>;
    if (data[0]) {
      const f = data[0].cmb2?.decklist_auto_fields ?? {};
      meta = {
        slug: data[0].slug,
        url: data[0].link,
        player: f.decklist_player_name ?? "",
        hero: f.decklist_hero ?? "",
        event: f.decklist_event_name ?? "",
        format: null,
      };
    }
  }

  // Fetch HTML for card data
  const htmlUrl = meta?.url ?? `https://fabtcg.com/decklists/${decklistSlug}/`;
  const htmlRes = await fetch(htmlUrl, { headers: BROWSER_HEADERS });
  if (!htmlRes.ok) return null;
  const html = await htmlRes.text();

  // Parse format from page
  const formatMatch = html.match(/<h3[^>]*>\s*Format\s*<\/h3>\s*<p[^>]*>([^<]+)<\/p>/i);
  if (meta && formatMatch) meta.format = formatMatch[1].trim();

  // Parse card sections — each <ul class="cards-container"> preceded by an HTML comment label
  const allComments = [...html.matchAll(/<!--\s*([^\n\-][^\-]*?)\s*-->/g)];
  const containers = [...html.matchAll(/<ul class="cards-container">([\s\S]*?)<\/ul>/g)];

  const equipment: DeckCard[] = [];
  const mainDeck: DeckCard[] = [];

  for (const container of containers) {
    const preceding = allComments.filter((c) => c.index! < container.index!);
    const label = preceding[preceding.length - 1]?.[1].trim() ?? "";
    const isEquipment = /hero.*weapon.*equipment/i.test(label) || /equipment/i.test(label);

    // Pitch value from label: "Pitch 0" / "Red" / "(red)" etc. OR from card name suffix
    const labelPitch = /\bred\b|pitch.*1|\(1\)/i.test(label) ? 1
      : /\byellow\b|pitch.*2|\(2\)/i.test(label) ? 2
      : /\bblue\b|pitch.*3|\(3\)/i.test(label) ? 3
      : null;

    const cards = [...container[1].matchAll(/<span>(\d+)x<\/span>\s*([^<\n]+)/g)].map((m) => {
      const rawName = stripHtml(m[2]);
      // Infer pitch from name suffix if not from label
      const pitchFromName = rawName.endsWith(" (red)") ? 1
        : rawName.endsWith(" (yel)") ? 2
        : rawName.endsWith(" (blu)") ? 3
        : null;
      const cleanName = rawName
        .replace(/ \(red\)$/, "").replace(/ \(yel\)$/, "").replace(/ \(blu\)$/, "");
      return {
        quantity: parseInt(m[1]),
        name: cleanName,
        pitch: pitchFromName ?? labelPitch,
      };
    });

    if (isEquipment) {
      equipment.push(...cards);
    } else {
      // Deduplicate — the page sometimes shows the same card in multiple pitch views
      for (const card of cards) {
        const exists = mainDeck.some((c) => c.name === card.name && c.pitch === card.pitch);
        if (!exists) mainDeck.push(card);
      }
    }
  }

  // Sort main deck: pitch 1 → 2 → 3 → null, then alphabetically
  mainDeck.sort((a, b) => {
    const pa = a.pitch ?? 99;
    const pb = b.pitch ?? 99;
    return pa !== pb ? pa - pb : a.name.localeCompare(b.name);
  });

  return {
    ...(meta ?? { slug: decklistSlug, url: htmlUrl, player: "", hero: "", event: "", format: null }),
    equipment,
    mainDeck,
  };
}
