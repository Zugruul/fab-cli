/**
 * cardmarket-expansions.ts — regenerates data/cardmarket-expansions.json
 * (SPEC-PRICE.md §7.2).
 *
 * Fetches the full tcgcsv catalog (groups + per-group products) and the
 * Cardmarket product list, runs the pure anchoring algorithm
 * (src/pricing/expansionAnchoring.ts), merges the result with any existing
 * committed file (the `overrides` section is preserved verbatim; `votes` is
 * always regenerated from scratch), and writes the file pretty-printed with
 * ascending numeric key order so diffs stay reviewable.
 *
 * This is a one-off/manual generation step — network access here is
 * expected and is NOT part of the merge gate (that stays offline).
 *
 * Usage:
 *   npx tsx scripts/cardmarket-expansions.ts
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  fetchGroups,
  fetchGroupProducts,
  mapWithConcurrency,
  type Product,
} from "../src/pricing/tcgcsv.ts";
import { fetchProducts } from "../src/pricing/cardmarket.ts";
import {
  buildExpansionAnchorMap,
  type ExpansionAnchorMap,
} from "../src/pricing/expansionAnchoring.ts";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(
  SCRIPT_DIR,
  "..",
  "data",
  "cardmarket-expansions.json",
);

function loadExistingOverrides(): Record<string, string> {
  if (!fs.existsSync(OUTPUT_PATH)) return {};
  const raw = fs.readFileSync(OUTPUT_PATH, "utf8");
  const parsed = JSON.parse(raw) as Partial<ExpansionAnchorMap>;
  return parsed.overrides ?? {};
}

/** Re-serializes with numeric-ascending key order for reviewable diffs. */
function sortedByNumericKey<T>(record: Record<string, T>): Record<string, T> {
  const sorted: Record<string, T> = {};
  for (const key of Object.keys(record).sort((a, b) => Number(a) - Number(b))) {
    sorted[key] = record[key];
  }
  return sorted;
}

async function main(): Promise<void> {
  console.log("Fetching tcgcsv groups...");
  const groups = await fetchGroups();
  console.log(`  ${groups.length} groups`);

  console.log("Fetching tcgcsv products per group (concurrency 4)...");
  const productsByGroupId = new Map<number, Product[]>();
  await mapWithConcurrency(groups, 4, async (group, index) => {
    const products = await fetchGroupProducts(group.groupId);
    productsByGroupId.set(group.groupId, products);
    console.log(
      `  [${index + 1}/${groups.length}] ${group.name} — ${products.length} products`,
    );
  });

  console.log("Fetching Cardmarket product catalog...");
  const cardmarketProducts = await fetchProducts();
  console.log(`  ${cardmarketProducts.length} Cardmarket products`);

  const overrides = loadExistingOverrides();
  const generatedAt = new Date().toISOString();

  const map = buildExpansionAnchorMap(
    groups,
    productsByGroupId,
    cardmarketProducts,
    generatedAt,
    overrides,
  );
  map.votes = sortedByNumericKey(map.votes);
  map.overrides = sortedByNumericKey(map.overrides);

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(map, null, 2) + "\n");

  const mappedCount = Object.keys(map.votes).length;
  const overrideCount = Object.keys(map.overrides).length;
  console.log(
    `\nWrote ${OUTPUT_PATH}: ${mappedCount} expansions voted, ${overrideCount} overrides.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
