import type { DeckCard } from "./graphql";
import type { GameResult, CardResult } from "./types";

export interface PitchStats {
  red: number; yellow: number; blue: number; none: number; total: number;
  redPct: number; yellowPct: number; bluePct: number; nonePct: number;
  avgPitch: number;
}

export interface CardActionStats {
  canPlay: number;    // has a cost (can be played for effect)
  canPitch: number;   // has a pitch value (can be used for resources)
  canBlock: number;   // has a defense value (can be used to defend)
  canAttack: number;  // has a power value (can attack)
  canPlayPct: number;
  canPitchPct: number;
  canBlockPct: number;
  canAttackPct: number;
}

export interface DeckCompositionStats {
  pitch: PitchStats;
  cardActions: CardActionStats;
  avgCost: number;
  avgPower: number;
  avgDefense: number;
  costDist: Map<number, number>;       // cost → total copies
  powerDist: Map<number, number>;
  defenseDist: Map<number, number>;
  typeDist: Map<string, number>;       // type → total copies
  subtypeDist: Map<string, number>;
  keywordCounts: Map<string, number>;  // keyword → total copies with that keyword
  talentCounts: Map<string, number>;
  rarityCounts: Map<string, number>;
  handDraw: HandDrawStats;
  mainDeckTotal: number;
}

export interface HandDrawStats {
  expectedResources: number;     // expected pitch value of a 4-card hand
  probAtLeastOneBlue: number;
  probAtLeastOneRed: number;
  probAtLeastOneGoAgain: number;
}

export interface CardUsageStat {
  cardIdentifier: string;
  seen: number;     // blocked + pitched + played
  blocked: number;
  pitched: number;
  played: number;
}

export interface SummaryStats {
  goingFirstWins: number;
  goingFirstTotal: number;
  goingFirstWinRate: number;
  goingSecondWins: number;
  goingSecondTotal: number;
  goingSecondWinRate: number;
  avgTurns: number;
  avgTurnsWins: number;
  avgTurnsLosses: number;
  cardUsage: CardUsageStat[];   // sorted by seen desc
}

export interface ResultStats {
  wins: number;
  losses: number;
  draws: number;
  total: number;
  winRate: number;
  bySource: Map<string, { wins: number; losses: number; total: number; winRate: number }>;
  summary: SummaryStats | null;  // null when no per-game data available
}

// Hypergeometric: P(X >= 1) = 1 - P(X = 0) = 1 - C(N-K, n) / C(N, n)
function probAtLeastOne(N: number, K: number, n: number): number {
  if (K <= 0) return 0;
  if (K >= N) return 1;
  // C(N-K, n) / C(N, n) = product of (N-K-i)/(N-i) for i=0..n-1
  let p = 1;
  for (let i = 0; i < n; i++) {
    p *= (N - K - i) / (N - i);
    if (p <= 0) return 1;
  }
  return 1 - p;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function countDist(cards: DeckCard[], getValue: (c: DeckCard) => number | null): Map<number, number> {
  const dist = new Map<number, number>();
  for (const c of cards) {
    const v = getValue(c);
    if (v !== null) dist.set(v, (dist.get(v) ?? 0) + c.quantity);
  }
  return new Map([...dist.entries()].sort((a, b) => a[0] - b[0]));
}

function countStringDist(cards: DeckCard[], getValues: (c: DeckCard) => string[]): Map<string, number> {
  const dist = new Map<string, number>();
  for (const c of cards) {
    for (const v of getValues(c)) {
      dist.set(v, (dist.get(v) ?? 0) + c.quantity);
    }
  }
  return new Map([...dist.entries()].sort((a, b) => b[1] - a[1]));
}

export function computeDeckStats(mainCards: DeckCard[]): DeckCompositionStats {
  const total = mainCards.reduce((s, c) => s + c.quantity, 0);

  // Pitch
  let red = 0, yellow = 0, blue = 0, none = 0;
  const pitchValues: number[] = [];
  for (const c of mainCards) {
    const p = c.cardData?.pitch ?? null;
    if (p === 1) red += c.quantity;
    else if (p === 2) yellow += c.quantity;
    else if (p === 3) blue += c.quantity;
    else none += c.quantity;
    if (p !== null) for (let i = 0; i < c.quantity; i++) pitchValues.push(p);
  }

  const pitch: PitchStats = {
    red, yellow, blue, none, total,
    redPct: total ? red / total : 0,
    yellowPct: total ? yellow / total : 0,
    bluePct: total ? blue / total : 0,
    nonePct: total ? none / total : 0,
    avgPitch: avg(pitchValues),
  };

  // Averages (only cards with the stat defined)
  const costsAll: number[] = [];
  const powersAll: number[] = [];
  const defensesAll: number[] = [];
  for (const c of mainCards) {
    for (let i = 0; i < c.quantity; i++) {
      if (c.cardData?.cost !== null && c.cardData?.cost !== undefined) costsAll.push(c.cardData.cost);
      if (c.cardData?.power !== null && c.cardData?.power !== undefined) powersAll.push(c.cardData.power);
      if (c.cardData?.defense !== null && c.cardData?.defense !== undefined) defensesAll.push(c.cardData.defense);
    }
  }

  // Card actions (copies that can be played / pitched / blocked / attacked with)
  let canPlay = 0, canPitch = 0, canBlock = 0, canAttack = 0;
  for (const c of mainCards) {
    if (c.cardData?.cost !== null && c.cardData?.cost !== undefined) canPlay += c.quantity;
    if (c.cardData?.pitch !== null && c.cardData?.pitch !== undefined) canPitch += c.quantity;
    if (c.cardData?.defense !== null && c.cardData?.defense !== undefined) canBlock += c.quantity;
    if (c.cardData?.power !== null && c.cardData?.power !== undefined) canAttack += c.quantity;
  }
  const cardActions: CardActionStats = {
    canPlay, canPitch, canBlock, canAttack,
    canPlayPct: total ? canPlay / total : 0,
    canPitchPct: total ? canPitch / total : 0,
    canBlockPct: total ? canBlock / total : 0,
    canAttackPct: total ? canAttack / total : 0,
  };

  // Go Again count for hand draw
  let goAgainCount = 0;
  for (const c of mainCards) {
    if (c.cardData?.keywords?.includes("Go again")) goAgainCount += c.quantity;
  }

  const handDraw: HandDrawStats = {
    expectedResources: pitch.avgPitch * 4,
    probAtLeastOneBlue: probAtLeastOne(total, blue, 4),
    probAtLeastOneRed: probAtLeastOne(total, red, 4),
    probAtLeastOneGoAgain: probAtLeastOne(total, goAgainCount, 4),
  };

  return {
    pitch,
    cardActions,
    avgCost: avg(costsAll),
    avgPower: avg(powersAll),
    avgDefense: avg(defensesAll),
    costDist: countDist(mainCards, c => c.cardData?.cost ?? null),
    powerDist: countDist(mainCards, c => c.cardData?.power ?? null),
    defenseDist: countDist(mainCards, c => c.cardData?.defense ?? null),
    typeDist: countStringDist(mainCards, c => c.cardData?.types ?? []),
    subtypeDist: countStringDist(mainCards, c => c.cardData?.subtypes ?? []),
    keywordCounts: countStringDist(mainCards, c => c.cardData?.keywords ?? []),
    talentCounts: countStringDist(mainCards, c => c.cardData?.talents ?? []),
    rarityCounts: countStringDist(mainCards, c => c.cardData?.rarity ? [c.cardData.rarity] : []),
    handDraw,
    mainDeckTotal: total,
  };
}

export function computeResultStats(results: GameResult[]): ResultStats {
  let wins = 0, losses = 0, draws = 0;
  const bySource = new Map<string, { wins: number; losses: number; total: number; winRate: number }>();

  // Per-game summary data
  let goingFirstWins = 0, goingFirstTotal = 0;
  let goingSecondWins = 0, goingSecondTotal = 0;
  const turnsList: number[] = [];
  const turnsWins: number[] = [];
  const turnsLosses: number[] = [];
  const cardTotals = new Map<string, { blocked: number; pitched: number; played: number }>();
  let hasPerGameData = false;

  for (const r of results) {
    if (r.result === "Won") wins++;
    else if (r.result === "Lost") losses++;
    else draws++;

    const src = r.source ?? "Unknown";
    const s = bySource.get(src) ?? { wins: 0, losses: 0, total: 0, winRate: 0 };
    if (r.result === "Won") s.wins++;
    else if (r.result === "Lost") s.losses++;
    s.total++;
    s.winRate = s.total > 0 ? s.wins / s.total : 0;
    bySource.set(src, s);

    // Per-game data (firstPlayer / turns / cardResults)
    if (r.firstPlayer !== null && r.firstPlayer !== undefined) {
      hasPerGameData = true;
      if (r.firstPlayer) {
        goingFirstTotal++;
        if (r.result === "Won") goingFirstWins++;
      } else {
        goingSecondTotal++;
        if (r.result === "Won") goingSecondWins++;
      }
    }

    if (r.turns !== null && r.turns !== undefined) {
      turnsList.push(r.turns);
      if (r.result === "Won") turnsWins.push(r.turns);
      else if (r.result === "Lost") turnsLosses.push(r.turns);
    }

    for (const cr of r.cardResults ?? []) {
      const t = cardTotals.get(cr.cardIdentifier) ?? { blocked: 0, pitched: 0, played: 0 };
      t.blocked += cr.blocked ?? 0;
      t.pitched += cr.pitched ?? 0;
      t.played += cr.played ?? 0;
      cardTotals.set(cr.cardIdentifier, t);
    }
  }

  const total = wins + losses + draws;

  let summary: SummaryStats | null = null;
  if (hasPerGameData) {
    const cardUsage: CardUsageStat[] = [...cardTotals.entries()]
      .map(([cardIdentifier, t]) => ({
        cardIdentifier,
        seen: t.blocked + t.pitched + t.played,
        blocked: t.blocked,
        pitched: t.pitched,
        played: t.played,
      }))
      .sort((a, b) => b.seen - a.seen);

    const avgArr = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

    summary = {
      goingFirstWins,
      goingFirstTotal,
      goingFirstWinRate: goingFirstTotal > 0 ? goingFirstWins / goingFirstTotal : 0,
      goingSecondWins,
      goingSecondTotal,
      goingSecondWinRate: goingSecondTotal > 0 ? goingSecondWins / goingSecondTotal : 0,
      avgTurns: avgArr(turnsList),
      avgTurnsWins: avgArr(turnsWins),
      avgTurnsLosses: avgArr(turnsLosses),
      cardUsage,
    };
  }

  return { wins, losses, draws, total, winRate: total > 0 ? wins / total : 0, bySource, summary };
}
