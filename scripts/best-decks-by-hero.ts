/**
 * best-decks-by-hero.ts — Best N decks per hero for a given format.
 *
 * For every hero that has decks in the chosen format (derived from the Algolia
 * `heroIdentifier` facet), fetch each deck's logged game results, compute the
 * W/L/D record, keep only decks with >= minGames, and emit the top N by win rate.
 *
 * Reproduces the "best 3 decks per hero valid in Sage (Silver Age)" report.
 *
 * Usage:
 *   npx tsx scripts/best-decks-by-hero.ts [--format sa] [--min-games 30] [--top 3] [--out whatsapp|json]
 *
 * Flags:
 *   --format     sa | cc | blitz | ll | upf  (default: sa)   -- "Sage" == Silver Age (sa)
 *   --min-games  minimum logged games for a deck to qualify   (default: 30)
 *   --top        decks to keep per hero                       (default: 3)
 *   --out        whatsapp (plain *bold* text) | json          (default: whatsapp)
 *
 * Notes:
 *   - Result-fetching is auth'd via getValidToken(); a burst trips AWS WAF (403 with a
 *     valid token), so concurrency is low (4) with retry/backoff and a per-hero delay.
 *     If you still get sustained 403s, wait a few minutes for the WAF cooldown and re-run.
 *   - win% = wins / (wins + losses); draws are reported but excluded from win%.
 */
import { getValidToken } from "../src/config.ts";
import { searchDecks } from "../src/algolia.ts";
import { getDeckResults, pLimit } from "../src/graphql.ts";

const FORMAT_ALIASES: Record<string, string> = {
  cc: "Classic Constructed",
  sa: "Silver Age",
  sage: "Silver Age", // user shorthand: "Sage" == Silver Age
  blitz: "Blitz",
  ll: "Living Legend",
  upf: "Ultimate Pit Fight",
};

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const formatKey = arg("format", "sa").toLowerCase();
const FORMAT = FORMAT_ALIASES[formatKey] ?? formatKey;
const MIN_GAMES = parseInt(arg("min-games", "30"), 10);
const TOP = parseInt(arg("top", "3"), 10);
const OUT = arg("out", "whatsapp");

const CONCURRENCY = 4; // keep low to avoid tripping the AppSync WAF
const CANDIDATES_PER_HERO = 40;

const title = (s: string) =>
  s.split("-").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");

interface DeckRow {
  name: string;
  w: number;
  l: number;
  d: number;
  games: number;
  wr: number;
  link: string;
}
interface HeroRow {
  hero: string;
  decks: DeckRow[];
}

async function main() {
  const token = await getValidToken();

  // 1. Heroes present in this format = heroIdentifier facet within format:<FORMAT>.
  const facetRes = await searchDecks({ format: FORMAT, limit: 0 } as any);
  const heroFacet: Record<string, number> =
    (facetRes as any).facets?.heroIdentifier ?? {};
  const heroes = Object.entries(heroFacet)
    .map(([hero, count]) => ({ hero, count: count as number }))
    .sort((a, b) => b.count - a.count);
  console.error(`Format "${FORMAT}": ${heroes.length} heroes; minGames=${MIN_GAMES}, top=${TOP}`);

  const out: HeroRow[] = [];

  for (const h of heroes) {
    const res = await searchDecks({
      hero: h.hero,
      format: FORMAT,
      hasResults: true,
      limit: CANDIDATES_PER_HERO,
    } as any);
    const hits = res.hits ?? [];

    const decks = await pLimit(
      hits.map((deck: any) => async () => {
        try {
          let r: any = null;
          for (let attempt = 0; attempt < 4; attempt++) {
            try {
              r = await getDeckResults(token, deck.deckId);
              break;
            } catch (err) {
              if (attempt === 3) throw err;
              await new Promise((res2) => setTimeout(res2, 2000 * (attempt + 1)));
            }
          }
          const rows = r.results ?? [];
          let w = 0, l = 0, d = 0;
          for (const g of rows) {
            if (g.result === "Won") w++;
            else if (g.result === "Lost") l++;
            else if (g.result === "Draw") d++;
          }
          const games = w + l + d;
          const wr = w + l > 0 ? w / (w + l) : 0;
          return { name: deck.name, w, l, d, games, wr, link: `https://fabrary.net/decks/${deck.deckId}` };
        } catch {
          return null;
        }
      }),
      CONCURRENCY
    );
    await new Promise((r) => setTimeout(r, 500)); // gentle per-hero pause

    const qualified = decks
      .filter((x): x is DeckRow => x !== null && x.games >= MIN_GAMES)
      .sort((a, b) => b.wr - a.wr)
      .slice(0, TOP);
    if (qualified.length) out.push({ hero: h.hero, decks: qualified });
    console.error(`${h.hero}: ${qualified.length}/${decks.filter(Boolean).length}`);
  }

  if (OUT === "json") {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  // WhatsApp-friendly plain text
  const lines: string[] = [];
  for (const h of out) {
    lines.push(`*${title(h.hero)}*`);
    h.decks.forEach((dk, i) => {
      const pct = Math.round(dk.wr * 100);
      lines.push(`${i + 1}. ${dk.name} — ${dk.w}W-${dk.l}L-${dk.d}D · ${pct}% · ${dk.games}g`);
      lines.push(`   ${dk.link}`);
    });
    lines.push("");
  }
  console.log(lines.join("\n"));
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
