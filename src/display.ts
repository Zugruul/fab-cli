import chalk from "chalk";
import Table from "cli-table3";
import type { AlgoliaDeck, DeckWithStats, FabCard } from "./types";
import type { DeckCardInventory } from "./graphql";
import type { DeckCompositionStats, ResultStats, CardUsageStat } from "./stats";
import type { HeroMetaRow, MetaPeriodGroup, MetaShiftRow } from "./meta";
import type { TournamentEvent, CoverageIndex, StandingsRow, DecklistMeta, PlayerDecklist, PlayerPath } from "./fabtcg";

export interface HeroGroup {
  hero: string;
  heroIdentifier: string;
  decks: DeckWithStats[];
}

export interface ClassGroup {
  className: string;
  heroGroups: HeroGroup[];
}

export interface HeroTopEntry {
  hero: string;
  topWinRate: DeckWithStats | null;
  topGames: DeckWithStats | null;
}

const FABRARY_BASE = "https://fabrary.net/decks";

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

function winRateColor(rate: number): string {
  const pct = rate * 100;
  const str = `${pct.toFixed(0)}%`;
  if (pct >= 60) return chalk.green(str);
  if (pct >= 50) return chalk.yellow(str);
  return chalk.red(str);
}

export function printDecksTable(decks: AlgoliaDeck[]): void {
  if (decks.length === 0) {
    console.log(chalk.yellow("No decks found."));
    return;
  }

  const table = new Table({
    head: [
      chalk.cyan("#"),
      chalk.cyan("Deck"),
      chalk.cyan("Hero"),
      chalk.cyan("Format"),
      chalk.cyan("Author"),
      chalk.cyan("Updated"),
      chalk.cyan("Link"),
    ],
    style: { compact: true },
    wordWrap: false,
  });

  decks.forEach((d, i) => {
    table.push([
      i + 1,
      d.name.slice(0, 28),
      d.hero.slice(0, 28),
      formatFormat(d.format),
      d.author,
      formatDate(d.updatedAt),
      chalk.blue(`${FABRARY_BASE}/${d.deckId}`),
    ]);
  });

  console.log(table.toString());
  console.log(chalk.dim(`${decks.length} decks`));
}

export function printTopTable(decks: DeckWithStats[]): void {
  if (decks.length === 0) {
    console.log(chalk.yellow("No decks found matching criteria."));
    return;
  }

  const table = new Table({
    head: [
      chalk.cyan("#"),
      chalk.cyan("Deck"),
      chalk.cyan("Hero"),
      chalk.cyan("Format"),
      chalk.cyan("W-L"),
      chalk.cyan("Win%"),
      chalk.cyan("Author"),
      chalk.cyan("Updated"),
      chalk.cyan("Link"),
    ],
    style: { compact: true },
    wordWrap: false,
  });

  decks.forEach((d, i) => {
    table.push([
      i + 1,
      d.name.slice(0, 24),
      d.hero.slice(0, 24),
      formatFormat(d.format),
      `${d.wins}-${d.losses}`,
      winRateColor(d.winRate),
      d.author,
      formatDate(d.updatedAt),
      chalk.blue(`${FABRARY_BASE}/${d.deckId}`),
    ]);
  });

  console.log(table.toString());
  console.log(chalk.dim(`${decks.length} decks shown`));
}

export function printGroupedTopTable(groups: HeroGroup[]): void {
  if (groups.length === 0) {
    console.log(chalk.yellow("No decks found matching criteria."));
    return;
  }

  let totalDecks = 0;
  for (const group of groups) {
    console.log(chalk.bold(`\n  ${group.hero}`));
    console.log(chalk.dim("  " + "─".repeat(48)));

    const table = new Table({
      head: [
        chalk.cyan("#"),
        chalk.cyan("Deck"),
        chalk.cyan("W-L"),
        chalk.cyan("Win%"),
        chalk.cyan("Author"),
        chalk.cyan("Updated"),
        chalk.cyan("Link"),
      ],
      style: { compact: true },
      wordWrap: false,
    });

    group.decks.forEach((d, i) => {
      table.push([
        i + 1,
        d.name.slice(0, 28),
        `${d.wins}-${d.losses}`,
        winRateColor(d.winRate),
        d.author.slice(0, 16),
        formatDate(d.updatedAt),
        chalk.blue(`${FABRARY_BASE}/${d.deckId}`),
      ]);
    });

    console.log(table.toString());
    totalDecks += group.decks.length;
  }

  console.log(chalk.dim(`\n${groups.length} heroes, ${totalDecks} decks`));
}

export function printClassGroupedTable(classGroups: ClassGroup[], topN: number): void {
  if (classGroups.length === 0) {
    console.log(chalk.yellow("No decks found matching criteria."));
    return;
  }

  let totalHeroes = 0;
  let totalDecks = 0;

  for (const cg of classGroups) {
    console.log(chalk.bold.underline(`\n${"═".repeat(4)} ${cg.className.toUpperCase()} ${"═".repeat(Math.max(0, 44 - cg.className.length))}`));

    for (const group of cg.heroGroups) {
      console.log(chalk.bold(`\n  ${group.hero}`));
      console.log(chalk.dim("  " + "─".repeat(48)));

      const table = new Table({
        head: [
          chalk.cyan("#"),
          chalk.cyan("Deck"),
          chalk.cyan("W-L"),
          chalk.cyan("Win%"),
          chalk.cyan("Author"),
          chalk.cyan("Updated"),
          chalk.cyan("Link"),
        ],
        style: { compact: true },
        wordWrap: false,
      });

      group.decks.forEach((d, i) => {
        table.push([
          i + 1,
          d.name.slice(0, 28),
          `${d.wins}-${d.losses}`,
          winRateColor(d.winRate),
          d.author.slice(0, 16),
          formatDate(d.updatedAt),
          chalk.blue(`${FABRARY_BASE}/${d.deckId}`),
        ]);
      });

      console.log(table.toString());
      totalDecks += group.decks.length;
      totalHeroes++;
    }
  }

  console.log(chalk.dim(`\n${classGroups.length} classes, ${totalHeroes} heroes, ${totalDecks} decks (top ${topN} per hero)`));
}

export function printPerHeroTable(rows: HeroTopEntry[]): void {
  if (rows.length === 0) {
    console.log(chalk.yellow("No data found."));
    return;
  }

  const table = new Table({
    head: [
      chalk.cyan("Hero"),
      chalk.cyan("Best Win% Deck"),
      chalk.cyan("Win%"),
      chalk.cyan("W-L"),
      chalk.cyan("Most Games Deck"),
      chalk.cyan("Win%"),
      chalk.cyan("Games"),
    ],
    style: { compact: true },
    wordWrap: false,
  });

  for (const row of rows) {
    const wr = row.topWinRate;
    const mg = row.topGames;
    const same = wr && mg && wr.deckId === mg.deckId;

    const wrName = wr ? wr.name.slice(0, 22) : chalk.dim("—");
    const wrPct  = wr ? winRateColor(wr.winRate) : chalk.dim("—");
    const wrWL   = wr ? `${wr.wins}-${wr.losses}` : chalk.dim("—");

    const mgName  = same ? chalk.dim("(same)") : mg ? mg.name.slice(0, 22) : chalk.dim("—");
    const mgPct   = same ? "" : mg ? winRateColor(mg.winRate) : chalk.dim("—");
    const mgGames = mg ? String(mg.total) : chalk.dim("—");

    table.push([
      row.hero.slice(0, 26),
      wrName,
      wrPct,
      wrWL,
      mgName,
      mgPct,
      mgGames,
    ]);
  }

  console.log(table.toString());
  console.log(chalk.dim(`${rows.length} heroes`));
}

export function printHeroesTable(
  heroes: Record<string, number>,
  filter?: string
): void {
  const sorted = Object.entries(heroes)
    .filter(([k]) => !filter || k.includes(filter.toLowerCase()))
    .sort((a, b) => b[1] - a[1]);

  const table = new Table({
    head: [chalk.cyan("Hero Identifier"), chalk.cyan("Decks")],
    style: { compact: true },
  });

  for (const [hero, count] of sorted) {
    table.push([hero, count]);
  }

  console.log(table.toString());
  console.log(chalk.dim(`${sorted.length} heroes`));
}

export function printFormatsTable(formats: Record<string, number>): void {
  const sorted = Object.entries(formats).sort((a, b) => b[1] - a[1]);

  const table = new Table({
    head: [chalk.cyan("Format"), chalk.cyan("Decks")],
    style: { compact: true },
  });

  for (const [format, count] of sorted) {
    table.push([format, count]);
  }

  console.log(table.toString());
}

export function printDeckDetail(
  deck: AlgoliaDeck,
  stats?: { wins: number; losses: number; total: number; winRate: number },
  matchups?: Array<{ name: string; preferredTurnOrder: string | null }>,
  cards?: Array<{ cardIdentifier: string; quantity: number }>,
  inventoryCards?: Array<{ cardIdentifier: string; sideboardQuantity: number }>,
  typeMap?: Map<string, string[]>
): void {
  console.log(chalk.bold(`\n${deck.name}`));
  console.log(chalk.dim("─".repeat(50)));
  console.log(`  Hero:    ${chalk.green(deck.hero)}`);
  console.log(`  Format:  ${deck.format}`);
  console.log(`  Author:  ${deck.author}`);
  console.log(`  Updated: ${formatDate(deck.updatedAt)}`);
  console.log(`  Link:    ${chalk.blue(`${FABRARY_BASE}/${deck.deckId}`)}`);

  if (stats && stats.total > 0) {
    console.log(chalk.dim("─".repeat(50)));
    console.log(
      `  Record:  ${chalk.green(stats.wins)}W - ${chalk.red(stats.losses)}L  (${winRateColor(stats.winRate)} win rate)`
    );
  }

  if (matchups && matchups.length > 0) {
    console.log(chalk.dim("─".repeat(50)));
    console.log("  Matchup guides:");
    for (const m of matchups) {
      const order = m.preferredTurnOrder
        ? chalk.dim(` [go ${m.preferredTurnOrder.toLowerCase()}]`)
        : "";
      console.log(`    • ${m.name}${order}`);
    }
  }

  if (deck.tags.length > 0) {
    console.log(chalk.dim("─".repeat(50)));
    console.log(`  Tags: ${deck.tags.join(", ")}`);
  }

  if (cards && cards.length > 0) {
    const isEquipmentOrHero = (id: string) => {
      const types = typeMap?.get(id) ?? [];
      return types.some((t) => t === "Equipment" || t === "Hero" || t === "Weapon");
    };

    const arenaCards = cards.filter((c) => isEquipmentOrHero(c.cardIdentifier));
    const actionCards = cards.filter((c) => !isEquipmentOrHero(c.cardIdentifier));
    const arenaTotal = arenaCards.reduce((s, c) => s + c.quantity, 0);
    const deckTotal = actionCards.reduce((s, c) => s + c.quantity, 0);
    const invTotal = inventoryCards ? inventoryCards.reduce((s, c) => s + c.sideboardQuantity, 0) : 0;
    const grandTotal = 1 + arenaTotal + deckTotal + invTotal; // +1 for hero

    console.log(chalk.dim("─".repeat(50)));
    console.log(chalk.bold(`  Cards (${grandTotal} total — 1 hero + ${arenaTotal} arena, ${deckTotal} deck, ${invTotal} inventory):`));

    console.log(chalk.dim(`    ${"─".repeat(30)} hero + equipment (${1 + arenaTotal})`));
    console.log(`    1x ${deck.heroIdentifier}`);
    for (const card of arenaCards) {
      console.log(`    ${card.quantity}x ${card.cardIdentifier}`);
    }

    console.log(chalk.dim(`    ${"─".repeat(30)} main deck (${deckTotal})`));
    for (const card of actionCards) {
      console.log(`    ${card.quantity}x ${card.cardIdentifier}`);
    }

    if (inventoryCards && inventoryCards.length > 0) {
      console.log(chalk.dim(`    ${"─".repeat(30)} inventory (${invTotal})`));
      for (const card of inventoryCards) {
        console.log(`    ${card.sideboardQuantity}x ${card.cardIdentifier}`);
      }
    }
  }

  console.log();
}

export function printInventory(cards: DeckCardInventory[]): void {
  const missing = cards.filter((c) => c.have < c.quantity);
  const complete = missing.length === 0;

  console.log(chalk.bold("\n  Inventory:"));
  console.log(chalk.dim("  " + "─".repeat(46)));

  for (const c of cards) {
    const have = c.have;
    const need = c.quantity;
    const status =
      have >= need
        ? chalk.green(`${have}/${need}`)
        : chalk.red(`${have}/${need}`);
    console.log(`    ${status}  ${c.cardIdentifier}`);
  }

  console.log();
  if (complete) {
    console.log(chalk.green("  ✓ You have all cards for this deck."));
  } else {
    const totalMissing = missing.reduce((s, c) => s + (c.quantity - c.have), 0);
    console.log(chalk.red(`  ✗ Missing ${totalMissing} card(s):`));
    for (const c of missing) {
      console.log(chalk.red(`      ${c.quantity - c.have}x ${c.cardIdentifier}`));
    }
  }
  console.log();
}

// Strip pitch suffix for display when pitch dot is shown separately
// "funeral-moon-red" → "Funeral Moon", "vexing-quillhand" → "Vexing Quillhand"
function cardName(id: string): string {
  const pitchSuffixes = ["red", "yellow", "blue"];
  const parts = id.split("-");
  const last = parts[parts.length - 1];
  const nameParts = pitchSuffixes.includes(last) ? parts.slice(0, -1) : parts;
  return nameParts.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
}

function pitchDot(pitch: number | null | undefined): string {
  if (pitch === 1) return chalk.red(" ●");
  if (pitch === 2) return chalk.yellow(" ●●");
  if (pitch === 3) return chalk.blue(" ●●●");
  return "";
}

export function printMatchupCards(
  matchups: Array<{ matchupId: string; name: string; preferredTurnOrder: string | null; notes: string | null }>,
  cards: Array<{ cardIdentifier: string; quantity: number; cardData: { pitch: number | null } | null; matchupQuantities: Array<{ matchupId: string; quantity: number; sideboardQuantity: number | null }> | null }>,
  inventoryCards: Array<{ cardIdentifier: string; sideboardQuantity: number; cardData: { pitch: number | null } | null; matchupQuantities: Array<{ matchupId: string; quantity: number; sideboardQuantity: number | null }> | null }>
): void {
  for (const matchup of matchups) {
    // Compute matchup deck total (for header)
    const matchupMainCards = cards.map((c) => {
      const override = c.matchupQuantities?.find((mq) => mq.matchupId === matchup.matchupId);
      return override !== undefined ? override.quantity : c.quantity;
    });
    const matchupInvCards = inventoryCards.map((c) => {
      const override = c.matchupQuantities?.find((mq) => mq.matchupId === matchup.matchupId);
      return override?.sideboardQuantity ?? 0;
    });
    const total =
      matchupMainCards.reduce((s, q) => s + q, 0) +
      matchupInvCards.reduce((s, q) => s + q, 0);

    const formatTurnOrder = (t: string) =>
      t.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, c => c.toUpperCase());
    const order = matchup.preferredTurnOrder && matchup.preferredTurnOrder !== "NoPreference"
      ? chalk.dim(`  Preferred turn order: ${formatTurnOrder(matchup.preferredTurnOrder)}`)
      : chalk.dim("  Preferred turn order: No preference");
    console.log(chalk.bold(`\n  ${matchup.name}`));
    console.log(order);
    console.log(chalk.dim(`  Cards in deck: ${total}`));
    console.log(chalk.dim("  " + "─".repeat(46)));

    // Build diff: removed from main deck + added from inventory
    type DiffEntry = { qty: number; sign: "+" | "-"; id: string; pitch: number | null };
    const diff: DiffEntry[] = [];

    for (const c of cards) {
      const override = c.matchupQuantities?.find((mq) => mq.matchupId === matchup.matchupId);
      const matchupQty = override !== undefined ? override.quantity : c.quantity;
      const delta = matchupQty - c.quantity;
      if (delta < 0) diff.push({ qty: -delta, sign: "-", id: c.cardIdentifier, pitch: c.cardData?.pitch ?? null });
      else if (delta > 0) diff.push({ qty: delta, sign: "+", id: c.cardIdentifier, pitch: c.cardData?.pitch ?? null });
    }

    for (const c of inventoryCards) {
      const override = c.matchupQuantities?.find((mq) => mq.matchupId === matchup.matchupId);
      const matchupQty = override?.sideboardQuantity ?? 0;
      if (matchupQty > 0) diff.push({ qty: matchupQty, sign: "+", id: c.cardIdentifier, pitch: c.cardData?.pitch ?? null });
    }

    // Sort: removals before additions, then by pitch (null/equipment first, then 1→2→3)
    const pitchOrder = (p: number | null) => p === null ? 0 : p;
    diff.sort((a, b) => {
      if (a.sign !== b.sign) return a.sign === "-" ? -1 : 1;
      return pitchOrder(a.pitch) - pitchOrder(b.pitch);
    });

    if (diff.length === 0) {
      console.log(chalk.dim("    (no changes from base deck)"));
    } else {
      for (const d of diff) {
        const sign = d.sign === "-" ? chalk.red(`-${d.qty}x`) : chalk.green(`+${d.qty}x`);
        console.log(`    ${sign} ${cardName(d.id)}${pitchDot(d.pitch)}`);
      }
    }

    if (matchup.notes) {
      console.log(chalk.dim("  ──"));
      console.log(chalk.italic(`  ${matchup.notes}`));
    }
  }
  console.log();
}

const CARD_IMAGE_BASE = "https://fabrary.net/cards";

export function printCardsTable(cards: FabCard[]): void {
  if (cards.length === 0) {
    console.log(chalk.yellow("No cards found."));
    return;
  }

  const table = new Table({
    head: [
      chalk.cyan("#"),
      chalk.cyan("Name"),
      chalk.cyan("Type"),
      chalk.cyan("Cost"),
      chalk.cyan("Atk"),
      chalk.cyan("Def"),
      chalk.cyan("Pitch"),
      chalk.cyan("Rarity"),
      chalk.cyan("Class"),
      chalk.cyan("Keywords"),
      chalk.cyan("Sets"),
      chalk.cyan("Spec"),
    ],
    style: { compact: true },
    wordWrap: false,
  });

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const types = [...c.types, ...c.subtypes].join(", ");
    const pitch = c.pitch !== null && c.pitch !== undefined ? String(c.pitch) : "-";
    const cost = c.cost !== null && c.cost !== undefined ? String(c.cost) : "-";
    const power = c.power !== null && c.power !== undefined ? String(c.power) : "-";
    const defense = c.defense !== null && c.defense !== undefined ? String(c.defense) : "-";
    const keywords = c.keywords?.slice(0, 2).join(", ") ?? "-";
    const sets = [...new Set(c.printings.map((p) => p.set))].slice(0, 2).join(", ");
    const spec = c.specializations?.join(", ") ?? "-";
    const cls = c.classes?.join(", ") ?? "-";
    const rarity = rarityColor(c.rarity);

    table.push([
      i + 1,
      c.name.slice(0, 28),
      types.slice(0, 20),
      cost,
      power,
      defense,
      pitch,
      rarity,
      cls.slice(0, 14),
      keywords.slice(0, 18),
      sets.slice(0, 20),
      spec.slice(0, 14),
    ]);
  }

  console.log(table.toString());
  console.log(chalk.dim(`${cards.length} cards found`));
}

export function printCardDetail(card: FabCard): void {
  console.log(chalk.bold(`\n${card.name}`));
  console.log(chalk.dim("─".repeat(60)));
  console.log(`  Identifier: ${card.cardIdentifier}`);
  console.log(`  Types:      ${[...card.types, ...card.subtypes].join(", ")}`);
  console.log(`  Rarity:     ${rarityColor(card.rarity)}`);
  if (card.classes?.length)
    console.log(`  Class:      ${card.classes.join(", ")}`);
  if (card.talents?.length)
    console.log(`  Talent:     ${card.talents.join(", ")}`);
  if (card.cost !== null && card.cost !== undefined)
    console.log(`  Cost:       ${card.cost}`);
  if (card.power !== null && card.power !== undefined)
    console.log(`  Power:      ${card.power}`);
  if (card.defense !== null && card.defense !== undefined)
    console.log(`  Defense:    ${card.defense}`);
  if (card.pitch !== null && card.pitch !== undefined) {
    const pitchColors = ["", chalk.red, chalk.yellow, chalk.blue];
    const fn = pitchColors[card.pitch] ?? chalk.white;
    console.log(`  Pitch:      ${fn(String(card.pitch))}`);
  }
  if (card.fusions?.length)
    console.log(`  Fusions:    ${card.fusions.join(", ")}`);
  if (card.keywords?.length)
    console.log(`  Keywords:   ${card.keywords.join(", ")}`);
  if (card.specializations?.length)
    console.log(`  Spec for:   ${card.specializations.join(", ")}`);
  if (card.hero)
    console.log(`  Hero:       ${card.hero}`);
  if (card.restrictedFormats?.length)
    console.log(`  Restricted: ${chalk.red(card.restrictedFormats.join(", "))}`);
  if (card.artists?.length)
    console.log(`  Artists:    ${card.artists.join(", ")}`);

  const uniqueSets = [...new Set(card.printings.map((p) => p.set))];
  console.log(`  Sets:       ${uniqueSets.join(", ")}`);

  console.log(chalk.dim("─".repeat(60)));
  console.log("  Printings:");
  for (const p of card.printings) {
    const foil = p.foiling ? ` [${p.foiling}]` : "";
    const ed = p.edition ? ` (${p.edition})` : "";
    const treat = p.treatment ? ` {${p.treatment}}` : "";
    console.log(
      `    • ${p.identifier}${foil}${ed}${treat} — ${p.set} (${rarityColor(p.rarity)})`
    );
  }
  console.log(
    `  Link:       ${chalk.blue(`${CARD_IMAGE_BASE}?query=${encodeURIComponent(card.name)}`)}`
  );
  console.log();
}

function rarityColor(rarity: string): string {
  switch (rarity) {
    case "Marvel": return chalk.magentaBright(rarity);
    case "Legendary": return chalk.yellowBright(rarity);
    case "Majestic": return chalk.yellow(rarity);
    case "Rare": return chalk.cyan(rarity);
    case "Common": return chalk.white(rarity);
    case "Token": return chalk.gray(rarity);
    case "Promo": return chalk.green(rarity);
    default: return rarity;
  }
}

function formatFormat(f: string): string {
  return f
    .replace("Classic Constructed", "CC")
    .replace("Silver Age", "SA")
    .replace("Living Legend", "LL")
    .replace("Ultimate Pit Fight", "UPF");
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function bar(n: number, total: number, width = 20): string {
  const filled = Math.round((n / total) * width);
  return chalk.cyan("█".repeat(filled)) + chalk.dim("░".repeat(width - filled));
}

// "funeral-moon-red" → "Funeral Moon (Red)"
function formatCardId(id: string): string {
  const pitchSuffixes: Record<string, string> = { red: "Red", yellow: "Yellow", blue: "Blue" };
  const parts = id.split("-");
  const last = parts[parts.length - 1];
  if (pitchSuffixes[last]) {
    const name = parts.slice(0, -1).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
    return `${name} (${pitchSuffixes[last]})`;
  }
  return parts.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
}

export function printDeckStats(
  deckName: string,
  deck: DeckCompositionStats,
  results: ResultStats
): void {
  const sep = chalk.dim("─".repeat(50));
  console.log(chalk.bold(`\n  Stats — ${deckName}`));

  // ── Results ─────────────────────────────────────────
  console.log(sep);
  console.log(chalk.bold("  Results"));
  if (results.total === 0) {
    console.log(chalk.dim("    No results recorded."));
  } else {
    console.log(`    ${chalk.green(results.wins)}W - ${chalk.red(results.losses)}L${results.draws ? ` - ${results.draws}D` : ""}  (${winRateColor(results.winRate)} win rate)  ${results.total} games`);
    if (results.bySource.size > 1 || (results.bySource.size === 1 && !results.bySource.has("Unknown"))) {
      for (const [src, s] of results.bySource) {
        console.log(`    ${chalk.dim(src.padEnd(12))}  ${chalk.green(s.wins)}W-${chalk.red(s.losses)}L  ${winRateColor(s.winRate)}`);
      }
    }
  }

  // ── Summary ──────────────────────────────────────────
  if (results.summary) {
    const s = results.summary;
    console.log(sep);
    console.log(chalk.bold("  Summary"));
    if (s.goingFirstTotal > 0) {
      console.log(`    Going first:   ${winRateColor(s.goingFirstWinRate)} (${s.goingFirstWins}/${s.goingFirstTotal})`);
    }
    if (s.goingSecondTotal > 0) {
      console.log(`    Going second:  ${winRateColor(s.goingSecondWinRate)} (${s.goingSecondWins}/${s.goingSecondTotal})`);
    }
    if (s.avgTurns > 0) {
      console.log(`    Avg turns:     ${s.avgTurns.toFixed(1)}${s.avgTurnsWins > 0 ? `  (wins: ${s.avgTurnsWins.toFixed(1)}, losses: ${s.avgTurnsLosses.toFixed(1)})` : ""}`);
    }
  }

  // ── Card Usage ───────────────────────────────────────
  if (results.summary && results.summary.cardUsage.length > 0) {
    const usage = results.summary.cardUsage;
    const totalSeen = usage.reduce((s, c) => s + c.seen, 0);
    console.log(sep);
    console.log(chalk.bold("  Actions Taken With Cards") + chalk.dim(`  (${results.total} games)`));
    const usageTable = new Table({
      head: [
        chalk.cyan("Card"),
        chalk.cyan("Seen"),
        chalk.cyan("Blocked"),
        chalk.cyan("Pitched"),
        chalk.cyan("Played"),
      ],
      style: { compact: true },
      colAligns: ["left", "right", "right", "right", "right"],
    });
    for (const c of usage) {
      usageTable.push([
        formatCardId(c.cardIdentifier),
        c.seen,
        c.blocked > 0 ? c.blocked : chalk.dim("—"),
        c.pitched > 0 ? c.pitched : chalk.dim("—"),
        c.played > 0 ? c.played : chalk.dim("—"),
      ]);
    }
    console.log(usageTable.toString());
    void totalSeen;
  }

  // ── Card Actions ─────────────────────────────────────
  console.log(sep);
  console.log(chalk.bold("  Actions Per Card") + chalk.dim("  (main deck copies)"));
  const { cardActions } = deck;
  console.log(`    ${"Play (has effect)".padEnd(20)}  ${bar(cardActions.canPlay, deck.mainDeckTotal)}  ${String(cardActions.canPlay).padStart(2)}  ${pct(cardActions.canPlayPct)}`);
  console.log(`    ${"Pitch (resources)".padEnd(20)}  ${bar(cardActions.canPitch, deck.mainDeckTotal)}  ${String(cardActions.canPitch).padStart(2)}  ${pct(cardActions.canPitchPct)}`);
  console.log(`    ${"Block (defense)".padEnd(20)}  ${bar(cardActions.canBlock, deck.mainDeckTotal)}  ${String(cardActions.canBlock).padStart(2)}  ${pct(cardActions.canBlockPct)}`);
  console.log(`    ${"Attack (has power)".padEnd(20)}  ${bar(cardActions.canAttack, deck.mainDeckTotal)}  ${String(cardActions.canAttack).padStart(2)}  ${pct(cardActions.canAttackPct)}`);

  // ── Pitch ────────────────────────────────────────────
  console.log(sep);
  console.log(chalk.bold("  Pitch Distribution") + chalk.dim(`  (${deck.mainDeckTotal} main deck cards, avg ${deck.pitch.avgPitch.toFixed(2)})`));
  const { pitch } = deck;
  if (pitch.red > 0)    console.log(`    ${chalk.red("Red   ")}  ${bar(pitch.red, pitch.total)}  ${String(pitch.red).padStart(2)}  ${pct(pitch.redPct)}`);
  if (pitch.yellow > 0) console.log(`    ${chalk.yellow("Yellow")}  ${bar(pitch.yellow, pitch.total)}  ${String(pitch.yellow).padStart(2)}  ${pct(pitch.yellowPct)}`);
  if (pitch.blue > 0)   console.log(`    ${chalk.blue("Blue  ")}  ${bar(pitch.blue, pitch.total)}  ${String(pitch.blue).padStart(2)}  ${pct(pitch.bluePct)}`);
  if (pitch.none > 0)   console.log(`    ${chalk.dim("None  ")}  ${bar(pitch.none, pitch.total)}  ${String(pitch.none).padStart(2)}  ${pct(pitch.nonePct)}`);

  // ── Averages ─────────────────────────────────────────
  console.log(sep);
  console.log(chalk.bold("  Card Averages") + chalk.dim("  (main deck)"));
  if (deck.avgCost > 0)    console.log(`    Avg cost:    ${deck.avgCost.toFixed(2)}`);
  if (deck.avgPower > 0)   console.log(`    Avg power:   ${deck.avgPower.toFixed(2)}`);
  if (deck.avgDefense > 0) console.log(`    Avg defense: ${deck.avgDefense.toFixed(2)}`);

  // ── Cost distribution ────────────────────────────────
  if (deck.costDist.size > 0) {
    console.log(sep);
    console.log(chalk.bold("  Cost Distribution"));
    for (const [cost, count] of deck.costDist) {
      console.log(`    ${String(cost).padStart(2)}  ${bar(count, deck.mainDeckTotal)}  ${count}`);
    }
  }

  // ── Types ────────────────────────────────────────────
  console.log(sep);
  console.log(chalk.bold("  Types"));
  for (const [type, count] of deck.typeDist) {
    console.log(`    ${type.padEnd(22)}  ${bar(count, deck.mainDeckTotal)}  ${count}`);
  }
  if (deck.subtypeDist.size > 0) {
    console.log(chalk.dim("  Subtypes"));
    for (const [sub, count] of deck.subtypeDist) {
      console.log(`    ${sub.padEnd(22)}  ${bar(count, deck.mainDeckTotal)}  ${count}`);
    }
  }

  // ── Talents ──────────────────────────────────────────
  if (deck.talentCounts.size > 0) {
    console.log(sep);
    console.log(chalk.bold("  Talent Distribution"));
    for (const [talent, count] of deck.talentCounts) {
      console.log(`    ${talent.padEnd(22)}  ${bar(count, deck.mainDeckTotal)}  ${count}`);
    }
  }

  // ── Keywords ─────────────────────────────────────────
  if (deck.keywordCounts.size > 0) {
    console.log(sep);
    console.log(chalk.bold("  Keywords"));
    for (const [kw, count] of deck.keywordCounts) {
      console.log(`    ${kw.padEnd(22)}  ${bar(count, deck.mainDeckTotal)}  ${count}`);
    }
  }

  // ── Rarity ───────────────────────────────────────────
  console.log(sep);
  console.log(chalk.bold("  Rarity"));
  for (const [rarity, count] of deck.rarityCounts) {
    console.log(`    ${rarityColor(rarity).padEnd(22)}  ${bar(count, deck.mainDeckTotal)}  ${count}`);
  }

  // ── Hand Draw Probabilities ───────────────────────────
  console.log(sep);
  console.log(chalk.bold("  4-Card Hand Probabilities"));
  console.log(`    Expected resources:   ${deck.handDraw.expectedResources.toFixed(2)}`);
  console.log(`    P(≥1 blue):           ${pct(deck.handDraw.probAtLeastOneBlue)}`);
  console.log(`    P(≥1 red):            ${pct(deck.handDraw.probAtLeastOneRed)}`);
  console.log(`    P(≥1 Go again):       ${pct(deck.handDraw.probAtLeastOneGoAgain)}`);

  console.log();
}

// ─── meta results ─────────────────────────────────────────────────────────────

export function printMetaTable(rows: HeroMetaRow[], show = 30): void {
  if (rows.length === 0) {
    console.log(chalk.yellow("No meta data found."));
    return;
  }

  const sorted = rows
    .filter((r) => r.totalGames > 0)
    .sort((a, b) => b.overallWinRate - a.overallWinRate)
    .slice(0, show);

  const table = new Table({
    head: [
      chalk.cyan("#"),
      chalk.cyan("Hero"),
      chalk.cyan("Win Rate"),
      chalk.cyan("Games"),
    ],
    style: { compact: true },
  });

  sorted.forEach((r, i) => {
    table.push([
      i + 1,
      heroDisplay(r.hero),
      winRateColor(r.overallWinRate),
      r.totalGames,
    ]);
  });

  console.log(table.toString());
  console.log(chalk.dim(`${sorted.length} heroes`));
}

export function printHeroMatchups(hero: HeroMetaRow): void {
  console.log(chalk.bold(`\n  ${heroDisplay(hero.hero)} matchups`));
  console.log(chalk.dim(`  Overall: ${winRateColor(hero.overallWinRate)} across ${hero.totalGames} games\n`));

  if (hero.matchups.length === 0) {
    console.log(chalk.dim("  No matchup data available."));
    return;
  }

  const sorted = hero.matchups
    .filter((m) => m.games > 0)
    .sort((a, b) => b.winRate - a.winRate);

  const table = new Table({
    head: [
      chalk.cyan("Opponent"),
      chalk.cyan("Win Rate"),
      chalk.cyan("W"),
      chalk.cyan("L"),
      chalk.cyan("Games"),
    ],
    style: { compact: true },
  });

  for (const m of sorted) {
    table.push([
      heroDisplay(m.opponent),
      winRateColor(m.winRate),
      chalk.green(String(m.wins)),
      chalk.red(String(m.losses)),
      m.games,
    ]);
  }

  console.log(table.toString());
}

export function printMetaShiftTable(
  rows: MetaShiftRow[],
  opts: { ban?: string[]; myClasses?: string[]; show?: number } = {}
): void {
  if (rows.length === 0) {
    console.log(chalk.yellow("No meta shift data found."));
    return;
  }

  const show = opts.show ?? 20;
  const displayed = rows.slice(0, show);

  console.log(chalk.bold("\n  Meta Shift Analysis"));
  if (opts.ban?.length) {
    console.log(chalk.dim(`  Banned/removed: ${opts.ban.join(", ")}`));
  }
  if (opts.myClasses?.length) {
    console.log(chalk.dim(`  Your classes: ${opts.myClasses.join(", ")}`));
  }
  console.log();

  const table = new Table({
    head: [
      chalk.cyan("#"),
      chalk.cyan("Hero"),
      chalk.cyan("Adj WR"),
      chalk.cyan("7d WR"),
      chalk.cyan("30d WR"),
      chalk.cyan("Momentum"),
      chalk.cyan("Games (7d)"),
    ],
    style: { compact: true },
  });

  displayed.forEach((r, i) => {
    const momentum = r.momentum;
    const momStr = momentum === 0
      ? chalk.dim("  —  ")
      : momentum > 0
        ? chalk.green(`+${pct(momentum)}`)
        : chalk.red(pct(momentum));

    table.push([
      i + 1,
      heroDisplay(r.hero),
      winRateColor(r.adjustedWinRate),
      winRateColor(r.winRate7d),
      winRateColor(r.winRate30d),
      momStr,
      r.games7d > 0 ? r.games7d : chalk.dim("—"),
    ]);
  });

  console.log(table.toString());
  console.log(chalk.dim(`${displayed.length} heroes shown`));
}

export function printMetaPeriods(groups: MetaPeriodGroup[]): void {
  for (const group of groups) {
    console.log(chalk.bold(`\n  ${group.label}`));
    for (const opt of group.options) {
      console.log(`    ${chalk.cyan(opt.value.padEnd(30))}  ${chalk.dim(opt.label)}`);
    }
  }
  console.log();
}

function heroDisplay(id: string): string {
  // Convert hero-identifier-slug to Title Case Name
  return id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ─── fabtcg events ────────────────────────────────────────────────────────────

export function printEventsTable(events: TournamentEvent[]): void {
  if (events.length === 0) {
    console.log(chalk.yellow("No events found."));
    return;
  }

  const table = new Table({
    head: [
      chalk.cyan("#"),
      chalk.cyan("Name"),
      chalk.cyan("Tier"),
      chalk.cyan("Date"),
      chalk.cyan("Location"),
      chalk.cyan("Link"),
    ],
    style: { compact: true },
    wordWrap: false,
  });

  events.forEach((e, i) => {
    table.push([
      i + 1,
      e.name.slice(0, 36),
      e.tier ?? chalk.dim("—"),
      e.date ? e.date.slice(0, 10) : chalk.dim("—"),
      e.location.slice(0, 24) || chalk.dim("—"),
      chalk.blue(e.url.slice(0, 50)),
    ]);
  });

  console.log(table.toString());
  console.log(chalk.dim(`${events.length} events`));
}

// ─── fabtcg coverage ─────────────────────────────────────────────────────────

export function printCoverageIndex(idx: CoverageIndex): void {
  console.log(chalk.bold(`\n  ${idx.title}`));
  console.log(chalk.dim("  " + "─".repeat(50)));
  console.log(`  Coverage: ${chalk.blue(`https://fabtcg.com/coverage/${idx.slug}/`)}`);
  if (idx.standingRounds.length > 0) {
    console.log(`  Standing rounds:  ${idx.standingRounds.join(", ")}${idx.hasFinalStandings ? " + final" : ""}`);
  }
  if (idx.resultRounds.length > 0) {
    console.log(`  Result rounds:    ${idx.resultRounds.join(", ")}`);
  }
  console.log();
}

export function printStandings(rows: StandingsRow[], title: string): void {
  if (rows.length === 0) {
    console.log(chalk.yellow("No standings data found."));
    return;
  }

  console.log(chalk.bold(`\n  ${title}`));
  const table = new Table({
    head: [
      chalk.cyan("Rank"),
      chalk.cyan("Player"),
      chalk.cyan("Hero"),
      chalk.cyan("Wins"),
    ],
    style: { compact: true },
    wordWrap: false,
  });

  for (const r of rows) {
    table.push([
      r.rank,
      r.player.slice(0, 28),
      r.hero.slice(0, 30),
      r.wins > 0 ? r.wins : chalk.dim("—"),
    ]);
  }

  console.log(table.toString());
  console.log(chalk.dim(`${rows.length} players`));
}

export function printFieldMeta(rows: StandingsRow[]): void {
  if (rows.length === 0) {
    console.log(chalk.yellow("No field data found."));
    return;
  }

  // Aggregate hero counts
  const heroCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.hero) heroCounts.set(r.hero, (heroCounts.get(r.hero) ?? 0) + 1);
  }

  const sorted = [...heroCounts.entries()].sort((a, b) => b[1] - a[1]);
  const total = rows.length;

  console.log(chalk.bold(`\n  Field Breakdown  (${total} players)`));
  const table = new Table({
    head: [
      chalk.cyan("#"),
      chalk.cyan("Hero"),
      chalk.cyan("Count"),
      chalk.cyan("%"),
    ],
    style: { compact: true },
  });

  sorted.forEach(([hero, count], i) => {
    table.push([i + 1, hero.slice(0, 36), count, pct(count / total)]);
  });

  console.log(table.toString());
}

export function printDecklistMetas(decklists: DecklistMeta[]): void {
  if (decklists.length === 0) {
    console.log(chalk.yellow("No decklists found."));
    return;
  }

  const table = new Table({
    head: [
      chalk.cyan("#"),
      chalk.cyan("Player"),
      chalk.cyan("Hero"),
      chalk.cyan("Event"),
      chalk.cyan("Link"),
    ],
    style: { compact: true },
    wordWrap: false,
  });

  decklists.forEach((d, i) => {
    table.push([
      i + 1,
      d.player.slice(0, 24),
      d.hero.slice(0, 28),
      d.event.slice(0, 30),
      chalk.blue(d.url.slice(0, 52)),
    ]);
  });

  console.log(table.toString());
  console.log(chalk.dim(`${decklists.length} decklists`));
}

export function printPlayerDecklist(deck: PlayerDecklist): void {
  const pitchDotStr = (p: number | null) => {
    if (p === 1) return chalk.red(" ●");
    if (p === 2) return chalk.yellow(" ●●");
    if (p === 3) return chalk.blue(" ●●●");
    return "";
  };

  console.log(chalk.bold(`\n  ${deck.player || "Unknown Player"} — ${deck.hero || "Unknown Hero"}`));
  console.log(chalk.dim(`  ${deck.event || ""}`));
  if (deck.format) console.log(chalk.dim(`  Format: ${deck.format}`));
  console.log(chalk.dim(`  fabtcg: ${deck.url}`));
  if (deck.fabraryDeckId) {
    console.log(chalk.blue(`  fabrary: https://fabrary.net/decks/${deck.fabraryDeckId}`));
  }
  console.log(chalk.dim("  " + "─".repeat(50)));

  if (deck.equipment.length > 0) {
    const eqTotal = deck.equipment.reduce((s, c) => s + c.quantity, 0);
    console.log(chalk.dim(`    ${"─".repeat(28)} hero + equipment (${eqTotal})`));
    for (const c of deck.equipment) {
      console.log(`    ${c.quantity}x ${c.name}`);
    }
  }

  if (deck.mainDeck.length > 0) {
    const deckTotal = deck.mainDeck.reduce((s, c) => s + c.quantity, 0);
    console.log(chalk.dim(`    ${"─".repeat(28)} main deck (${deckTotal})`));
    let lastPitch: number | null | undefined = undefined;
    for (const c of deck.mainDeck) {
      if (lastPitch !== undefined && c.pitch !== lastPitch) {
        console.log(chalk.dim("    ─"));
      }
      lastPitch = c.pitch;
      console.log(`    ${c.quantity}x ${c.name}${pitchDotStr(c.pitch)}`);
    }
  }

  console.log();
}

export function printPlayerPath(path: PlayerPath): void {
  const formatFmt = (f: string) => {
    if (/classic.constructed/i.test(f) || f === "CC") return "CC";
    if (/silver.age/i.test(f) || f === "SA") return "SA";
    if (/blitz/i.test(f)) return "Blitz";
    if (/top.8/i.test(f) || f === "Top 8") return chalk.bold("Top 8");
    return f;
  };

  const resultBadge = (r: "W" | "L" | "D" | "Bye") => {
    if (r === "W") return chalk.green("  W  ");
    if (r === "L") return chalk.red("  L  ");
    if (r === "D") return chalk.yellow("  D  ");
    return chalk.dim("  —  ");
  };

  console.log(chalk.bold(`\n  ${path.event} — ${path.player}`));
  if (path.playerHero) console.log(chalk.dim(`  Playing: ${path.playerHero}`));
  console.log(chalk.dim("  " + "═".repeat(60)));

  const table = new Table({
    head: [
      chalk.cyan("Rnd"),
      chalk.cyan("Format"),
      chalk.cyan("Opponent"),
      chalk.cyan("Hero"),
      chalk.cyan("Result"),
      chalk.cyan("Record"),
    ],
    style: { compact: true },
    wordWrap: false,
  });

  let runW = 0;
  let runL = 0;
  for (const r of path.rounds) {
    if (r.result === "W") runW++;
    else if (r.result === "L") runL++;
    const record = r.result === "Bye"
      ? chalk.dim(`${runW}-${runL}`)
      : r.result === "W"
        ? chalk.green(`${runW}-${runL}`)
        : r.result === "L"
          ? chalk.red(`${runW}-${runL}`)
          : chalk.yellow(`${runW}-${runL}`);

    table.push([
      r.round,
      formatFmt(r.format),
      r.opponent.slice(0, 22),
      (r.opponentHero ?? chalk.dim("—")).slice(0, 28),
      resultBadge(r.result),
      record,
    ]);
  }

  console.log(table.toString());

  // Overall summary
  const total = path.wins + path.losses + path.draws;
  const overallWr = total > 0 ? ((path.wins / total) * 100).toFixed(0) + "%" : "—";
  console.log(
    `\n  Overall: ${chalk.green(path.wins + "W")} ${chalk.red(path.losses + "L")}` +
    (path.draws > 0 ? ` ${chalk.yellow(path.draws + "D")}` : "") +
    (path.byes > 0 ? ` ${chalk.dim(path.byes + " bye")}` : "") +
    `  (${overallWr})`
  );

  // Per-format breakdown
  if (path.byFormat.length > 1) {
    const fmtTable = new Table({
      head: [chalk.cyan("Format"), chalk.cyan("W"), chalk.cyan("L"), chalk.cyan("Win%")],
      style: { compact: true },
    });
    for (const f of path.byFormat) {
      const t = f.wins + f.losses;
      const wr = t > 0 ? ((f.wins / t) * 100).toFixed(0) + "%" : "—";
      fmtTable.push([
        formatFmt(f.format),
        chalk.green(f.wins),
        chalk.red(f.losses),
        t > 0 ? (f.wins / t >= 0.6 ? chalk.green(wr) : f.wins / t >= 0.5 ? chalk.yellow(wr) : chalk.red(wr)) : chalk.dim(wr),
      ]);
    }
    console.log(fmtTable.toString());
  }

  // Opponent hero breakdown
  const heroFreq = new Map<string, { count: number; wins: number; losses: number }>();
  for (const r of path.rounds) {
    const h = r.opponentHero ?? "Unknown";
    if (!heroFreq.has(h)) heroFreq.set(h, { count: 0, wins: 0, losses: 0 });
    const s = heroFreq.get(h)!;
    s.count++;
    if (r.result === "W") s.wins++;
    else if (r.result === "L") s.losses++;
  }
  const sortedHeroes = [...heroFreq.entries()].sort((a, b) => b[1].count - a[1].count || b[1].wins - a[1].wins);
  if (sortedHeroes.length > 0) {
    console.log(chalk.dim("\n  Matchup Spread:"));
    const hTable = new Table({
      head: [chalk.cyan("Opponent Hero"), chalk.cyan("Played"), chalk.cyan("W"), chalk.cyan("L")],
      style: { compact: true },
    });
    for (const [hero, s] of sortedHeroes) {
      hTable.push([
        hero.slice(0, 34),
        s.count,
        s.wins > 0 ? chalk.green(s.wins) : chalk.dim("0"),
        s.losses > 0 ? chalk.red(s.losses) : chalk.dim("0"),
      ]);
    }
    console.log(hTable.toString());
  }

  console.log();
}
