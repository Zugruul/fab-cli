import type { DeckCard } from "./graphql";
import type { GameResult } from "./types";

export interface PitchStats {
  red: number; yellow: number; blue: number; none: number; total: number;
  redPct: number; yellowPct: number; bluePct: number; nonePct: number;
  avgPitch: number;
}

export interface DeckCompositionStats {
  pitch: PitchStats;
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

export interface ResultStats {
  wins: number;
  losses: number;
  draws: number;
  total: number;
  winRate: number;
  bySource: Map<string, { wins: number; losses: number; total: number; winRate: number }>;
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
  }

  const total = wins + losses + draws;
  return { wins, losses, draws, total, winRate: total > 0 ? wins / total : 0, bySource };
}
