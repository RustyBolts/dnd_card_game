import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCardCatalogFromCsv } from "../shared/data/cardCatalog.js";
import { DEFAULT_CARD_CATALOG } from "../shared/rules/cardDefinitions.js";
import type { CardCatalog } from "../shared/types/cardCatalog.js";

export type HostCardCatalogLoadOptions = {
  cardsCsvPath?: string;
  starterDeckCsvPath?: string;
  version?: string;
  requireExternal?: boolean;
};

const DEFAULT_CARDS_CSV_PATH = "data/cards.csv";
const DEFAULT_STARTER_DECK_CSV_PATH = "data/starter_deck.csv";

export function loadCardCatalogForHost(options: HostCardCatalogLoadOptions = {}): CardCatalog {
  const cardsCsvPath = resolve(
    options.cardsCsvPath ?? process.env.CARDS_CSV_PATH ?? DEFAULT_CARDS_CSV_PATH
  );
  const starterDeckCsvPath = resolve(
    options.starterDeckCsvPath ?? process.env.STARTER_DECK_CSV_PATH ?? DEFAULT_STARTER_DECK_CSV_PATH
  );
  const hasCardsCsv = existsSync(cardsCsvPath);
  const hasStarterDeckCsv = existsSync(starterDeckCsvPath);

  if (hasCardsCsv && hasStarterDeckCsv) {
    return parseCardCatalogFromCsv({
      cardsCsv: readFileSync(cardsCsvPath, "utf8"),
      starterDeckCsv: readFileSync(starterDeckCsvPath, "utf8"),
      version: options.version ?? `local-csv:${cardsCsvPath}:${starterDeckCsvPath}`
    });
  }

  if (options.requireExternal || hasCardsCsv || hasStarterDeckCsv) {
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
