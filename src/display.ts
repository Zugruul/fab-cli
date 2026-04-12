import chalk from "chalk";
import Table from "cli-table3";
import type { AlgoliaDeck, DeckWithStats, FabCard } from "./types";
import type { DeckCardInventory } from "./graphql";
import type { DeckCompositionStats, ResultStats } from "./stats";

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

    console.log(chalk.dim(`    ${"─".repeat(30)} hero + equipment`));
    console.log(`    1x ${deck.heroIdentifier}`);
    for (const card of arenaCards) {
      console.log(`    ${card.quantity}x ${card.cardIdentifier}`);
    }

    console.log(chalk.dim(`    ${"─".repeat(30)} main deck`));
    for (const card of actionCards) {
      console.log(`    ${card.quantity}x ${card.cardIdentifier}`);
    }

    if (inventoryCards && inventoryCards.length > 0) {
      console.log(chalk.dim(`    ${"─".repeat(30)} inventory`));
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

export function printMatchupCards(
  matchups: Array<{ matchupId: string; name: string; preferredTurnOrder: string | null }>,
  cards: Array<{ cardIdentifier: string; quantity: number; matchupQuantities: Array<{ matchupId: string; quantity: number; sideboardQuantity: number | null }> | null }>,
  inventoryCards: Array<{ cardIdentifier: string; sideboardQuantity: number; matchupQuantities: Array<{ matchupId: string; quantity: number; sideboardQuantity: number | null }> | null }>
): void {
  for (const matchup of matchups) {
    // Main deck cards with quantity overrides applied
    const mainCards = cards
      .map((c) => {
        const override = c.matchupQuantities?.find((mq) => mq.matchupId === matchup.matchupId);
        const qty = override !== undefined ? override.quantity : c.quantity;
        return { cardIdentifier: c.cardIdentifier, quantity: qty };
      })
      .filter((c) => c.quantity > 0);

    // Inventory cards swapped in for this matchup
    const swappedIn = inventoryCards
      .map((c) => {
        const override = c.matchupQuantities?.find((mq) => mq.matchupId === matchup.matchupId);
        const qty = override?.sideboardQuantity ?? 0;
        return { cardIdentifier: c.cardIdentifier, quantity: qty };
      })
      .filter((c) => c.quantity > 0);

    const allCards = [...mainCards, ...swappedIn];
    const total = allCards.reduce((s, c) => s + c.quantity, 0);

    const order = matchup.preferredTurnOrder
      ? chalk.dim(` [go ${matchup.preferredTurnOrder.toLowerCase()}]`)
      : "";
    console.log(chalk.bold(`\n  vs ${matchup.name}${order}`) + chalk.dim(` (${total})`));
    console.log(chalk.dim("  " + "─".repeat(46)));
    for (const card of allCards) {
      console.log(`    ${card.quantity}x ${card.cardIdentifier}`);
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
