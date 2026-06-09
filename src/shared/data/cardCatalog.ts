import type {
  CardDefinition,
  CardEffectDefinition,
  CardTargeting,
  CardTargetScope,
  CardTargetSelection,
  CardType
} from "../types/card.js";
import type { CardCatalog } from "../types/cardCatalog.js";
import { defaultTargetingForEffect } from "../rules/cardTargets.js";

export type CardCatalogCsvInput = {
  cardsCsv: string;
  starterDeckCsv: string;
  version: string;
};

type CsvRecord = {
  rowNumber: number;
  values: Record<string, string>;
};

const CARD_TYPES = new Set(["ATTACK", "SKILL", "ITEM", "STATUS"]);
const EFFECT_TYPES = new Set(["DAMAGE", "HEAL", "DRAW"]);
const TARGET_SELECTIONS = new Set(["NONE", "SINGLE", "GROUP"]);
const TARGET_SCOPES = new Set(["SELF", "ALLY", "ENEMY", "ANY"]);

export function normalizePublishedCsvUrl(url: string): string {
  const parsedUrl = new URL(url);

  if (parsedUrl.hostname !== "docs.google.com") {
    return url;
  }

  if (!parsedUrl.pathname.includes("/spreadsheets/d/e/")) {
    return url;
  }

  if (parsedUrl.pathname.endsWith("/pubhtml")) {
    parsedUrl.pathname = parsedUrl.pathname.replace(/\/pubhtml$/, "/pub");
  }

  if (parsedUrl.pathname.endsWith("/pub")) {
    parsedUrl.searchParams.set("output", "csv");
  }

  return parsedUrl.toString();
}

export function parseCardCatalogFromCsv(input: CardCatalogCsvInput): CardCatalog {
  const cardDefinitions = parseCardsCsv(input.cardsCsv);
  const starterDeckCardIds = parseStarterDeckCsv(input.starterDeckCsv, cardDefinitions);

  if (starterDeckCardIds.length === 0) {
    throw new Error("starter_deck.csv must contain at least one enabled card.");
  }

  return {
    version: input.version,
    cardDefinitions,
    starterDeckCardIds
  };
}

export function parseCardCatalogJson(value: unknown, source: string): CardCatalog {
  const catalog = readRecord(value, source);
  const version = readRequiredString(catalog.version, "version", source);
  const definitionsRecord = readRecord(catalog.cardDefinitions, `${source}.cardDefinitions`);
  const starterDeckValue = catalog.starterDeckCardIds;

  if (!Array.isArray(starterDeckValue)) {
    throw new Error(`${source}.starterDeckCardIds must be an array.`);
  }

  const cardDefinitions: Record<string, CardDefinition> = {};
  for (const [cardId, rawDefinition] of Object.entries(definitionsRecord)) {
    const rowSource = `${source}.cardDefinitions.${cardId}`;
    const definitionRecord = readRecord(rawDefinition, rowSource);
    const parsedDefinition = parseCardDefinitionJsonRecord(definitionRecord, rowSource);

    if (parsedDefinition.cardId !== cardId) {
      throw new Error(`${rowSource}.cardId must match its catalog key.`);
    }

    cardDefinitions[cardId] = parsedDefinition;
  }

  const starterDeckCardIds = starterDeckValue.map((rawCardId, index) => {
    const cardId = readRequiredString(rawCardId, `starterDeckCardIds[${index}]`, source);
    if (!cardDefinitions[cardId]) {
      throw new Error(`${source}.starterDeckCardIds[${index}] references unknown cardId "${cardId}".`);
    }
    return cardId;
  });

  if (starterDeckCardIds.length === 0) {
    throw new Error(`${source}.starterDeckCardIds must contain at least one card.`);
  }

  return {
    version,
    cardDefinitions,
    starterDeckCardIds
  };
}

function parseCardsCsv(csvText: string): Record<string, CardDefinition> {
  const records = parseCsvRecords(
    csvText,
    [
      "cardId",
      "name",
      "cost",
      "type",
      "description",
      "effectType",
      "effectValue",
      "effectCount",
      "enabled"
    ],
    "cards.csv"
  );
  const cardDefinitions: Record<string, CardDefinition> = {};

  for (const record of records) {
    if (!isEnabled(record.values.enabled)) {
      continue;
    }

    const source = `cards.csv row ${record.rowNumber}`;
    const definition = parseCardDefinitionRecord(record.values, source);

    if (cardDefinitions[definition.cardId]) {
      throw new Error(`${source} duplicates cardId "${definition.cardId}".`);
    }

    cardDefinitions[definition.cardId] = definition;
  }

  if (Object.keys(cardDefinitions).length === 0) {
    throw new Error("cards.csv must contain at least one enabled card.");
  }

  return cardDefinitions;
}

function parseStarterDeckCsv(
  csvText: string,
  cardDefinitions: Record<string, CardDefinition>
): string[] {
  const records = parseCsvRecords(csvText, ["cardId", "count"], "starter_deck.csv");
  const starterDeckCardIds: string[] = [];

  for (const record of records) {
    const source = `starter_deck.csv row ${record.rowNumber}`;
    const cardId = readRequiredString(record.values.cardId, "cardId", source);
    const count = parseInteger(record.values.count, "count", source, 1);

    if (!cardDefinitions[cardId]) {
      throw new Error(`${source} references unknown cardId "${cardId}".`);
    }

    for (let copy = 0; copy < count; copy += 1) {
      starterDeckCardIds.push(cardId);
    }
  }

  return starterDeckCardIds;
}

function parseCardDefinitionRecord(
  record: Record<string, unknown>,
  source: string
): CardDefinition {
  const effect = parseEffect(record, source);

  return {
    cardId: readRequiredString(record.cardId, "cardId", source),
    name: readRequiredString(record.name, "name", source),
    cost: parseInteger(record.cost, "cost", source, 0),
    type: parseCardType(record.type, source),
    description: readRequiredString(record.description, "description", source),
    effect,
    targeting: parseTargetingRecord(record, effect, source)
  };
}

function parseCardDefinitionJsonRecord(
  record: Record<string, unknown>,
  source: string
): CardDefinition {
  const effect = parseEffectJson(record.effect, `${source}.effect`);

  return {
    cardId: readRequiredString(record.cardId, "cardId", source),
    name: readRequiredString(record.name, "name", source),
    cost: parseInteger(record.cost, "cost", source, 0),
    type: parseCardType(record.type, source),
    description: readRequiredString(record.description, "description", source),
    effect,
    targeting: parseTargetingJson(record.targeting, effect, `${source}.targeting`)
  };
}

function parseEffect(record: Record<string, unknown>, source: string): CardEffectDefinition {
  const effectType = parseEffectType(record.effectType, "effectType", source);

  if (effectType === "DRAW") {
    const rawCount = readOptionalString(record.effectCount) || readOptionalString(record.effectValue);
    return {
      type: "DRAW",
      count: parseInteger(rawCount, "effectCount", source, 1)
    };
  }

  return {
    type: effectType,
    value: parseInteger(record.effectValue, "effectValue", source, 0)
  };
}

function parseEffectJson(value: unknown, source: string): CardEffectDefinition {
  const record = readRecord(value, source);
  const effectType = parseEffectType(record.type, "type", source);

  if (effectType === "DRAW") {
    return {
      type: "DRAW",
      count: parseInteger(record.count, "count", source, 1)
    };
  }

  return {
    type: effectType,
    value: parseInteger(record.value, "value", source, 0)
  };
}

function parseTargetingRecord(
  record: Record<string, unknown>,
  effect: CardEffectDefinition,
  source: string
): CardTargeting {
  const rawSelection = readOptionalString(record.targetSelection);
  const rawScope = readOptionalString(record.targetScope);
  const rawRequired = readOptionalString(record.targetRequired);

  if (!rawSelection && !rawScope && !rawRequired) {
    return defaultTargetingForEffect(effect);
  }

  if (!rawSelection || !rawScope) {
    throw new Error(`${source} targetSelection and targetScope must be provided together.`);
  }

  const selection = parseTargetSelection(rawSelection, "targetSelection", source);
  const scope = parseTargetScope(rawScope, "targetScope", source);

  return validateTargeting(
    {
      selection,
      scope,
      requiresTarget: rawRequired
        ? parseBoolean(rawRequired, "targetRequired", source)
        : defaultRequiresTarget(selection, scope)
    },
    source
  );
}

function parseTargetingJson(
  value: unknown,
  effect: CardEffectDefinition,
  source: string
): CardTargeting {
  if (value === undefined || value === null) {
    return defaultTargetingForEffect(effect);
  }

  const record = readRecord(value, source);
  const selection = parseTargetSelection(record.selection, "selection", source);
  const scope = parseTargetScope(record.scope, "scope", source);

  return validateTargeting(
    {
      selection,
      scope,
      requiresTarget: record.requiresTarget !== undefined
        ? parseBoolean(record.requiresTarget, "requiresTarget", source)
        : defaultRequiresTarget(selection, scope)
    },
    source
  );
}

function parseCardType(value: unknown, source: string): CardType {
  const cardType = readRequiredString(value, "type", source).toUpperCase();

  if (!CARD_TYPES.has(cardType)) {
    throw new Error(`${source} type must be ATTACK, SKILL, ITEM, or STATUS.`);
  }

  return cardType as CardType;
}

function parseEffectType(
  value: unknown,
  field: string,
  source: string
): CardEffectDefinition["type"] {
  const effectType = readRequiredString(value, field, source).toUpperCase();

  if (!EFFECT_TYPES.has(effectType)) {
    throw new Error(`${source} ${field} must be DAMAGE, HEAL, or DRAW.`);
  }

  return effectType as CardEffectDefinition["type"];
}

function parseTargetSelection(
  value: unknown,
  field: string,
  source: string
): CardTargetSelection {
  const selection = readRequiredString(value, field, source).toUpperCase();

  if (!TARGET_SELECTIONS.has(selection)) {
    throw new Error(`${source} ${field} must be NONE, SINGLE, or GROUP.`);
  }

  return selection as CardTargetSelection;
}

function parseTargetScope(value: unknown, field: string, source: string): CardTargetScope {
  const scope = readRequiredString(value, field, source).toUpperCase();

  if (!TARGET_SCOPES.has(scope)) {
    throw new Error(`${source} ${field} must be SELF, ALLY, ENEMY, or ANY.`);
  }

  return scope as CardTargetScope;
}

function parseBoolean(value: unknown, field: string, source: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = readRequiredString(value, field, source).toLowerCase();

  if (["true", "1", "yes", "y"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "n"].includes(normalized)) {
    return false;
  }

  throw new Error(`${source} ${field} must be true or false.`);
}

function defaultRequiresTarget(
  selection: CardTargetSelection | string,
  scope: CardTargetScope | string
): boolean {
  return selection === "SINGLE";
}

function validateTargeting(targeting: CardTargeting, source: string): CardTargeting {
  if (targeting.selection === "NONE" && targeting.requiresTarget) {
    throw new Error(`${source} targetRequired cannot be true when targetSelection is NONE.`);
  }

  if (targeting.selection === "GROUP") {
    return {
      ...targeting,
      requiresTarget: false
    };
  }

  return targeting;
}

function parseInteger(value: unknown, field: string, source: string, min: number): number {
  const rawValue = readRequiredString(value, field, source);
  const parsed = Number(rawValue);

  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${source} ${field} must be an integer >= ${min}.`);
  }

  return parsed;
}

function parseCsvRecords(csvText: string, requiredHeaders: string[], source: string): CsvRecord[] {
  const rows = parseCsvRows(csvText);
  const headerRow = rows[0];

  if (!headerRow) {
    throw new Error(`${source} must include a header row.`);
  }

  for (const header of requiredHeaders) {
    if (!headerRow.includes(header)) {
      throw new Error(`${source} is missing required header "${header}".`);
    }
  }

  return rows.slice(1).map((row, index) => {
    const values: Record<string, string> = {};
    headerRow.forEach((header, headerIndex) => {
      values[header] = row[headerIndex] ?? "";
    });

    return {
      rowNumber: index + 2,
      values
    };
  });
}

function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushRow = () => {
    row.push(field.trim());
    field = "";

    if (row.some((cell) => cell.length > 0)) {
      rows.push(row);
    }

    row = [];
  };

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];

    if (inQuotes) {
      if (char === '"') {
        if (csvText[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(field.trim());
      field = "";
      continue;
    }

    if (char === "\n") {
      pushRow();
      continue;
    }

    if (char === "\r") {
      if (csvText[index + 1] !== "\n") {
        pushRow();
      }
      continue;
    }

    field += char;
  }

  if (inQuotes) {
    throw new Error("CSV input has an unterminated quoted field.");
  }

  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  return rows;
}

function readRecord(value: unknown, source: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${source} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function readRequiredString(value: unknown, field: string, source: string): string {
  const text = readOptionalString(value);

  if (!text) {
    throw new Error(`${source} ${field} is required.`);
  }

  return text;
}

function readOptionalString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number") {
    return String(value);
  }

  return "";
}

function isEnabled(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized !== "false" && normalized !== "0" && normalized !== "no";
}
