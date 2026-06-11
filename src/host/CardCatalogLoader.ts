import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCardCatalogFromCsv } from "../shared/data/cardCatalog.js";
import { DEFAULT_CARD_CATALOG } from "../shared/rules/cardDefinitions.js";
import type { CardCatalog } from "../shared/types/cardCatalog.js";

export type HostCardCatalogLoadOptions = {
  cardsCsvPath?: string;
  starterDeckCsvPath?: string;
  transformRulesCsvPath?: string;
  racesCsvPath?: string;
  version?: string;
  requireExternal?: boolean;
};

const DEFAULT_CARDS_CSV_PATH = "data/cards.csv";
const DEFAULT_STARTER_DECK_CSV_PATH = "data/starter_deck.csv";
const DEFAULT_TRANSFORM_RULES_CSV_PATH = "data/transform_rules.csv";
const DEFAULT_RACES_CSV_PATH = "data/races.csv";

export function loadCardCatalogForHost(options: HostCardCatalogLoadOptions = {}): CardCatalog {
  const cardsCsvPath = resolve(
    options.cardsCsvPath ?? process.env.CARDS_CSV_PATH ?? DEFAULT_CARDS_CSV_PATH
  );
  const starterDeckCsvPath = resolve(
    options.starterDeckCsvPath ?? process.env.STARTER_DECK_CSV_PATH ?? DEFAULT_STARTER_DECK_CSV_PATH
  );
  const transformRulesCsvPath = resolve(
    options.transformRulesCsvPath ??
      process.env.TRANSFORM_RULES_CSV_PATH ??
      DEFAULT_TRANSFORM_RULES_CSV_PATH
  );
  const racesCsvPath = resolve(options.racesCsvPath ?? process.env.RACES_CSV_PATH ?? DEFAULT_RACES_CSV_PATH);
  const hasCardsCsv = existsSync(cardsCsvPath);
  const hasStarterDeckCsv = existsSync(starterDeckCsvPath);
  const hasTransformRulesCsv = existsSync(transformRulesCsvPath);
  const hasRacesCsv = existsSync(racesCsvPath);

  if (hasCardsCsv && hasStarterDeckCsv) {
    return parseCardCatalogFromCsv({
      cardsCsv: readFileSync(cardsCsvPath, "utf8"),
      starterDeckCsv: readFileSync(starterDeckCsvPath, "utf8"),
      transformRulesCsv: hasTransformRulesCsv ? readFileSync(transformRulesCsvPath, "utf8") : undefined,
      racesCsv: hasRacesCsv ? readFileSync(racesCsvPath, "utf8") : undefined,
      version:
        options.version ??
        `local-csv:${cardsCsvPath}:${starterDeckCsvPath}${hasTransformRulesCsv ? `:${transformRulesCsvPath}` : ""}${hasRacesCsv ? `:${racesCsvPath}` : ""}`
    });
  }

  if (options.requireExternal || hasCardsCsv || hasStarterDeckCsv || hasTransformRulesCsv) {
    throw new Error(
      `Card catalog CSV files must be provided together. Missing: ${[
        hasCardsCsv ? null : cardsCsvPath,
        hasStarterDeckCsv ? null : starterDeckCsvPath
      ]
        .filter(Boolean)
        .join(", ")}`
    );
  }

  return DEFAULT_CARD_CATALOG;
}
