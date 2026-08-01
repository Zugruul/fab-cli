import { httpFetch } from "./http";

const META_BASE = "https://content.fabrary.net/results";
const META_PAGE = "https://fabrary.net/meta-results";

const META_FORMAT_SLUGS: Record<string, string> = {
  // full names
  "classic constructed": "classic-constructed",
  "silver age": "silver-age",
  "blitz": "blitz",
  "living legend": "living-legend",
  "ultimate pit fight": "ultimate-pit-fight",
  // short aliases
  cc: "classic-constructed",
  sa: "silver-age",
  ll: "living-legend",
  upf: "ultimate-pit-fight",
};

export interface MetaPeriodOption {
  value: string;
  label: string;
}

export interface MetaPeriodGroup {
  label: string;
  options: MetaPeriodOption[];
}

export interface HeroMatchup {
  hero: string;
  opponent: string;
  wins: number;
  losses: number;
  games: number;
  winRate: number;
}

export interface HeroMetaRow {
  hero: string;
  overallWinRate: number;
  totalGames: number;
  matchups: HeroMatchup[];
}

export interface MetaShiftRow {
  hero: string;
  winRate7d: number;
  winRate30d: number;
  games7d: number;
  games30d: number;
  momentum: number; // winRate7d - winRate30d
  adjustedWinRate: number; // after ban/nerf modifiers
}

// ─── period discovery ────────────────────────────────────────────────────────
//
// The fabrary.net/meta-results page is a Vite SPA — the <select id="Time">
// element only exists in the browser DOM. We replicate the same logic the app
// uses to build the period list:
//
//   Rolling  → always "last-7-days" and "last-30-days"
//   Season   → Standalone Booster / Expansion Booster sets released ≥ Sep 2025,
//              slugified as name.toLowerCase().replaceAll(" ", "-")
//              We fetch the page's JS bundle and parse the releases array.
//   Months   → every month from Nov 2025 through the current month
//              (include current month if today's date >= 2)

const EARLIEST_MONTH_YEAR = { year: 2025, month: 10 }; // Nov 2025 (0-indexed month)
const EARLIEST_SET_DATE   = new Date(2025, 8);          // Sep 2025

const MAIN_SET_TYPES = new Set([
  "Standalone Booster",
  "Expansion Booster",
]);

function getRollingPeriods(): MetaPeriodOption[] {
  return [
    { value: "last-7-days",  label: "Last 7 Days"  },
    { value: "last-30-days", label: "Last 30 Days" },
  ];
}

function getMonthlyPeriods(): MetaPeriodOption[] {
  const MONTH_NAMES = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
  ];
  const now = new Date();
  // Match app behaviour: include current month only if day >= 2
  if (now.getDate() < 2) now.setMonth(now.getMonth() - 1);

  const result: MetaPeriodOption[] = [];
  for (let y = EARLIEST_MONTH_YEAR.year; y <= now.getFullYear(); y++) {
    const startM = y === EARLIEST_MONTH_YEAR.year ? EARLIEST_MONTH_YEAR.month : 0;
    const endM   = y === now.getFullYear() ? now.getMonth() : 11;
    for (let m = startM; m <= endM; m++) {
      const mm = String(m + 1).padStart(2, "0");
      result.push({ value: `${y}-${mm}`, label: `${MONTH_NAMES[m]} ${y}` });
    }
  }
  return result.reverse(); // newest first
}

async function getSeasonPeriods(): Promise<MetaPeriodOption[]> {
  // Fetch the app's HTML to find the current JS bundle URL, then extract releases
  try {
    const pageRes = await httpFetch(META_PAGE, {
      preset: "fabrary",
      headers: { Accept: "text/html" },
    });
    if (!pageRes.ok) return [];
    const html = await pageRes.text();

    const scriptMatch = html.match(/<script[^>]*src="([^"]*\/assets\/index-[^"]+\.js)"[^>]*>/);
    if (!scriptMatch) return [];

    const bundleUrl = scriptMatch[1].startsWith("http")
      ? scriptMatch[1]
      : `https://fabrary.net${scriptMatch[1]}`;

    const bundleRes = await httpFetch(bundleUrl, { preset: "fabrary" });
    if (!bundleRes.ok) return [];
    const js = await bundleRes.text();

    // Extract: release:"Name",...,releaseDate:"YYYY-...",releaseType:"Type"
    const releaseRe =
      /release:"([^"]+)"[^}]*releaseDate:"(\d{4}-\d{2}-\d{2})[^"]*"[^}]*releaseType:"([^"]+)"/g;
    const now = new Date();
    const seasons: MetaPeriodOption[] = [];
    const seen = new Set<string>();

    let m: RegExpExecArray | null;
    while ((m = releaseRe.exec(js)) !== null) {
      const [, name, dateStr, type] = m;
      if (!MAIN_SET_TYPES.has(type)) continue;
      const releaseDate = new Date(dateStr);
      if (releaseDate < EARLIEST_SET_DATE) continue;
      // Must have been out for at least 2 days
      const withBuffer = new Date(releaseDate);
      withBuffer.setDate(withBuffer.getDate() + 2);
      if (now < withBuffer) continue;

      const slug = name.toLowerCase().replaceAll(" ", "-");
      if (seen.has(slug)) continue;
      seen.add(slug);
      seasons.push({ value: slug, label: name });
    }

    return seasons.reverse(); // newest first
  } catch {
    return [];
  }
}

export async function fetchMetaPeriods(): Promise<MetaPeriodGroup[]> {
  const [seasons, months] = await Promise.all([
    getSeasonPeriods(),
    Promise.resolve(getMonthlyPeriods()),
  ]);

  const groups: MetaPeriodGroup[] = [
    { label: "Rolling", options: getRollingPeriods() },
  ];
  if (seasons.length > 1) {
    groups.push({ label: "Season", options: seasons });
  }
  groups.push({ label: "Months", options: months });
  return groups;
}

// ─── format / period resolution ──────────────────────────────────────────────

export function resolveMetaFormat(format: string): string {
  const key = format.toLowerCase().trim();
  return META_FORMAT_SLUGS[key] ?? key;
}

/** Resolve shorthand period inputs to slugs.
 *  "7d"  → "last-7-days"
 *  "30d" → "last-30-days"
 *  "2026-04" → "2026-04"
 *  anything else → as-is
 */
export function resolveMetaPeriod(period: string): string {
  if (period === "7d") return "last-7-days";
  if (period === "30d") return "last-30-days";
  return period;
}

// ─── today param ─────────────────────────────────────────────────────────────

function getTodayParam(): string {
  const now = new Date();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return [
    days[now.getUTCDay()],
    months[now.getUTCMonth()],
    now.getUTCDate(),
    now.getUTCFullYear(),
    now.getUTCHours(),
  ].join("-");
}

// ─── meta results fetch + parse ──────────────────────────────────────────────

export async function fetchMetaResults(
  format: string,
  period: string
): Promise<HeroMetaRow[]> {
  const slug = resolveMetaFormat(format);
  const p = resolveMetaPeriod(period);
  const today = getTodayParam();
  const url = `${META_BASE}/all-${slug}-${p}.json?today=${today}`;

  const res = await httpFetch(url, { preset: "fabrary" });
  if (!res.ok) {
    throw new Error(`Failed to fetch meta results (${slug}, ${p}): ${res.status} ${res.statusText}`);
  }
  const raw: unknown = await res.json();
  return parseMetaResults(raw);
}

function parseMetaResults(raw: unknown): HeroMetaRow[] {
  if (raw === null || typeof raw !== "object") return [];

  if (!Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;

    // Shape A (actual): { heroResults: [ { heroIdentifier, results: [...] } ] }
    if (Array.isArray(obj["heroResults"])) {
      return parseFabraryShape(obj["heroResults"] as Record<string, unknown>[]);
    }

    // Shape B: { results: [...] } or { data: [...] }
    for (const key of ["results", "data", "heroes", "rows"]) {
      if (Array.isArray(obj[key])) {
        return parseMetaResults(obj[key]);
      }
    }

    // Shape C: { "hero-id": { wins, losses, matchups: [...] } }
    return parseHeroObjectShape(obj);
  }

  const arr = raw as unknown[];
  if (arr.length === 0) return [];
  const first = arr[0] as Record<string, unknown>;

  // Shape D: flat matchup records [{ hero, opponent, wins, losses }]
  if ("opponent" in first || "opponentHero" in first) {
    return parseFlatMatchupRecords(arr as Record<string, unknown>[]);
  }

  // Shape E: per-hero rows with nested matchups
  if ("matchups" in first || "heroMatchups" in first) {
    return parseHeroRowsShape(arr as Record<string, unknown>[]);
  }

  // Shape F: per-hero rows (summary only)
  return parseSummaryOnlyShape(arr as Record<string, unknown>[]);
}

/** Parse the actual fabrary.net JSON format:
 *  [ { heroIdentifier, results: [ { opposingHeroIdentifier, plays, wins, ... } ] } ]
 */
function parseFabraryShape(heroRows: Record<string, unknown>[]): HeroMetaRow[] {
  return heroRows.map((row) => {
    const hero = String(row.heroIdentifier ?? "");
    const rawResults = (row.results ?? []) as Array<{
      opposingHeroIdentifier: string;
      plays: number;
      wins: number;
    }>;

    let totalPlays = 0;
    let totalWins  = 0;

    const matchups: HeroMatchup[] = rawResults.map((r) => {
      const plays = r.plays ?? 0;
      const wins  = r.wins  ?? 0;
      const losses = plays - wins;
      totalPlays += plays;
      totalWins  += wins;
      return {
        hero,
        opponent: String(r.opposingHeroIdentifier ?? ""),
        wins,
        losses,
        games: plays,
        winRate: plays > 0 ? wins / plays : 0,
      };
    });

    return {
      hero,
      overallWinRate: totalPlays > 0 ? totalWins / totalPlays : 0,
      totalGames: totalPlays,
      matchups,
    };
  });
}

function heroKey(record: Record<string, unknown>): string {
  return String(record.hero ?? record.heroIdentifier ?? record.heroId ?? record.id ?? "");
}

function opponentKey(record: Record<string, unknown>): string {
  return String(record.opponent ?? record.opponentHero ?? record.opponentId ?? "");
}

function numField(record: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = record[k];
    if (typeof v === "number") return v;
    if (typeof v === "string" && !isNaN(Number(v))) return Number(v);
  }
  return 0;
}

function winsLossesToWinRate(wins: number, losses: number): number {
  const total = wins + losses;
  return total > 0 ? wins / total : 0;
}

function parseFlatMatchupRecords(records: Record<string, unknown>[]): HeroMetaRow[] {
  const byHero = new Map<string, { totalWins: number; totalLosses: number; matchups: HeroMatchup[] }>();

  for (const r of records) {
    const hero = heroKey(r);
    const opponent = opponentKey(r);
    const wins = numField(r, "wins", "win");
    const losses = numField(r, "losses", "loss");
    const games = wins + losses || numField(r, "games", "total");
    const winRate = numField(r, "winRate", "win_rate") || winsLossesToWinRate(wins, losses);

    if (!byHero.has(hero)) byHero.set(hero, { totalWins: 0, totalLosses: 0, matchups: [] });
    const entry = byHero.get(hero)!;
    entry.totalWins += wins;
    entry.totalLosses += losses;
    if (opponent) {
      entry.matchups.push({ hero, opponent, wins, losses, games, winRate });
    }
  }

  return Array.from(byHero.entries()).map(([hero, { totalWins, totalLosses, matchups }]) => ({
    hero,
    overallWinRate: winsLossesToWinRate(totalWins, totalLosses),
    totalGames: totalWins + totalLosses,
    matchups,
  }));
}

function parseHeroRowsShape(records: Record<string, unknown>[]): HeroMetaRow[] {
  return records.map((r) => {
    const hero = heroKey(r);
    const wins = numField(r, "wins", "win");
    const losses = numField(r, "losses", "loss");
    const total = wins + losses || numField(r, "games", "totalGames", "total");
    const overallWinRate =
      numField(r, "winRate", "win_rate", "overallWinRate") || winsLossesToWinRate(wins, losses);

    const rawMatchups = ((r.matchups ?? r.heroMatchups ?? []) as Record<string, unknown>[]);
    const matchups: HeroMatchup[] = rawMatchups.map((m) => {
      const opp = opponentKey(m) || String(m.name ?? "");
      const mWins = numField(m, "wins", "win");
      const mLosses = numField(m, "losses", "loss");
      const mGames = mWins + mLosses || numField(m, "games", "total");
      const mWinRate = numField(m, "winRate", "win_rate") || winsLossesToWinRate(mWins, mLosses);
      return { hero, opponent: opp, wins: mWins, losses: mLosses, games: mGames, winRate: mWinRate };
    });

    return { hero, overallWinRate, totalGames: total, matchups };
  });
}

function parseHeroObjectShape(obj: Record<string, unknown>): HeroMetaRow[] {
  return Object.entries(obj).map(([hero, val]) => {
    const v = val as Record<string, unknown>;
    const wins = numField(v, "wins", "win");
    const losses = numField(v, "losses", "loss");
    const total = wins + losses || numField(v, "games", "total");
    const overallWinRate =
      numField(v, "winRate", "win_rate") || winsLossesToWinRate(wins, losses);

    const rawMatchups = ((v.matchups ?? []) as Record<string, unknown>[]);
    const matchups: HeroMatchup[] = rawMatchups.map((m) => {
      const opp = opponentKey(m) || String(m.name ?? "");
      const mWins = numField(m, "wins", "win");
      const mLosses = numField(m, "losses", "loss");
      const mGames = mWins + mLosses || numField(m, "games", "total");
      const mWinRate = numField(m, "winRate", "win_rate") || winsLossesToWinRate(mWins, mLosses);
      return { hero, opponent: opp, wins: mWins, losses: mLosses, games: mGames, winRate: mWinRate };
    });

    return { hero, overallWinRate, totalGames: total, matchups };
  });
}

function parseSummaryOnlyShape(records: Record<string, unknown>[]): HeroMetaRow[] {
  return records.map((r) => {
    const hero = heroKey(r);
    const wins = numField(r, "wins", "win");
    const losses = numField(r, "losses", "loss");
    const total = wins + losses || numField(r, "games", "totalGames", "total");
    const overallWinRate =
      numField(r, "winRate", "win_rate", "overallWinRate") || winsLossesToWinRate(wins, losses);
    return { hero, overallWinRate, totalGames: total, matchups: [] };
  });
}

// ─── meta shift analysis ─────────────────────────────────────────────────────

export interface MetaShiftOptions {
  format: string;
  ban?: string[];      // hero identifiers considered banned/severely nerfed
  nerf?: string[];     // hero identifiers considered lightly nerfed (~5-8% reduction)
  exclude?: string[];  // heroes to hide from output
  myClasses?: string[]; // filter output to heroes the user can play
}

export async function computeMetaShift(opts: MetaShiftOptions): Promise<MetaShiftRow[]> {
  const [data7d, data30d] = await Promise.all([
    fetchMetaResults(opts.format, "last-7-days"),
    fetchMetaResults(opts.format, "last-30-days"),
  ]);

  const map30 = new Map(data30d.map((r) => [r.hero, r]));
  const map7  = new Map(data7d.map((r) => [r.hero, r]));

  const allHeroes = new Set([...map7.keys(), ...map30.keys()]);
  const bannedSet  = new Set((opts.ban    ?? []).map((s) => s.toLowerCase()));
  const nerfedSet  = new Set((opts.nerf   ?? []).map((s) => s.toLowerCase()));
  const excludeSet = new Set((opts.exclude ?? []).map((s) => s.toLowerCase()));

  const rows: MetaShiftRow[] = [];
  for (const hero of allHeroes) {
    if (excludeSet.has(hero.toLowerCase())) continue;

    const r7  = map7.get(hero);
    const r30 = map30.get(hero);
    const wr7  = r7?.overallWinRate  ?? 0;
    const wr30 = r30?.overallWinRate ?? 0;
    const games7  = r7?.totalGames  ?? 0;
    const games30 = r30?.totalGames ?? 0;

    const isHeroBanned = bannedSet.has(hero.toLowerCase());
    const isHeroNerfed = nerfedSet.has(hero.toLowerCase());

    let adjusted = wr7;
    if (isHeroBanned) {
      // If the hero itself is banned, exclude from results entirely
      continue;
    }
    // If a banned hero was a common opponent, their absence benefits heroes
    // who previously lost to them. Apply a modest boost to heroes with
    // high loss rates against the banned opponents.
    for (const bannedHero of bannedSet) {
      const matchup7 = r7?.matchups.find((m) => m.opponent.toLowerCase() === bannedHero);
      if (matchup7 && matchup7.games >= 3) {
        const lossRate = 1 - matchup7.winRate;
        // Weight by share of total games that were against this banned hero
        const shareOfGames = matchup7.games / Math.max(games7, 1);
        adjusted += lossRate * shareOfGames * 0.8; // boost if struggled vs banned hero
      }
    }
    if (isHeroNerfed) adjusted -= 0.06;

    rows.push({
      hero,
      winRate7d: wr7,
      winRate30d: wr30,
      games7d: games7,
      games30d: games30,
      momentum: wr7 - wr30,
      adjustedWinRate: Math.min(1, Math.max(0, adjusted)),
    });
  }

  return rows.sort((a, b) => b.adjustedWinRate - a.adjustedWinRate);
}
