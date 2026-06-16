import type {
  CardActionTag,
  CardActionTagType,
  CardDefinition,
  CardEffectDefinition,
  CardResourceCosts,
  CardTargeting,
  CardTargetScope,
  CardTargetSelection,
  CardType
} from "../types/card.js";
import type { AbilityScores, NaturalArmorType, RaceDefinition } from "../types/character.js";
import type {
  CardCatalog,
  CardTransformRevertTiming,
  CardTransformRule,
  CardTransformScope
} from "../types/cardCatalog.js";
import { defaultTargetingForEffect } from "../rules/cardTargets.js";
import { ABILITY_KEYS } from "../types/character.js";
import {
  CREATION_ABILITY_MIN,
  DEFAULT_RACES
} from "../rules/characterRules.js";

export type CardCatalogCsvInput = {
  cardsCsv: string;
  starterDeckCsv: string;
  transformRulesCsv?: string;
  racesCsv?: string;
  version: string;
};

type CsvRecord = {
  rowNumber: number;
  values: Record<string, string>;
};

const CARD_TYPES = new Set(["ATTACK", "SKILL", "MAGE", "ITEM", "STATUS"]);
const EFFECT_TYPES = new Set(["NONE", "DAMAGE", "HEAL", "DRAW"]);
const ACTION_TAG_TYPES = new Set([
  "BONUS_ACTION",
  "REACTION_ACTION",
  "COUNTER_ACTION",
  "READY_ACTION"
]);
const TARGET_SELECTIONS = new Set(["NONE", "SINGLE", "GROUP"]);
const TARGET_SCOPES = new Set(["SELF", "ALLY", "ENEMY", "ANY"]);
const TRANSFORM_SCOPES = new Set(["OWNER_HAND"]);
const TRANSFORM_REVERT_TIMINGS = new Set(["NEVER", "TURN_END"]);
const NATURAL_ARMOR_TYPES = new Set(["NONE", "FUR", "SHELL", "SKIN"]);

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
  const transformRules = input.transformRulesCsv
    ? parseTransformRulesCsv(input.transformRulesCsv, cardDefinitions)
    : [];
  const races = input.racesCsv ? parseRacesCsv(input.racesCsv) : DEFAULT_RACES;

  if (starterDeckCardIds.length === 0) {
    throw new Error("starter_deck.csv must contain at least one enabled card.");
  }

  return {
    version: input.version,
    cardDefinitions,
    starterDeckCardIds,
    transformRules,
    races
  };
}

export function parseCardCatalogJson(value: unknown, source: string): CardCatalog {
  const catalog = readRecord(value, source);
  const version = readRequiredString(catalog.version, "version", source);
  const definitionsRecord = readRecord(catalog.cardDefinitions, `${source}.cardDefinitions`);
  const starterDeckValue = catalog.starterDeckCardIds;
  const transformRulesValue = catalog.transformRules ?? [];
  const racesValue = catalog.races;

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

  const transformRules = parseTransformRulesJson(
    transformRulesValue,
    cardDefinitions,
    `${source}.transformRules`
  );
  const races = racesValue === undefined
    ? DEFAULT_RACES
    : parseRacesJson(racesValue, `${source}.races`);

  return {
    version,
    cardDefinitions,
    starterDeckCardIds,
    transformRules,
    races
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

function parseTransformRulesCsv(
  csvText: string,
  cardDefinitions: Record<string, CardDefinition>
): CardTransformRule[] {
  const records = parseCsvRecords(
    csvText,
    [
      "ruleId",
      "triggerCardId",
      "sourceCardId",
      "targetCardId",
      "scope",
      "reversible",
      "revertTiming"
    ],
    "transform_rules.csv"
  );
  const rules: CardTransformRule[] = [];
  const seenRuleIds = new Set<string>();

  for (const record of records) {
    const source = `transform_rules.csv row ${record.rowNumber}`;
    const rule = validateTransformRule(
      {
        ruleId: readRequiredString(record.values.ruleId, "ruleId", source),
        triggerCardId: readRequiredString(record.values.triggerCardId, "triggerCardId", source),
        sourceCardId: readRequiredString(record.values.sourceCardId, "sourceCardId", source),
        targetCardId: readRequiredString(record.values.targetCardId, "targetCardId", source),
        scope: parseTransformScope(record.values.scope, "scope", source),
        reversible: parseBoolean(record.values.reversible, "reversible", source),
        revertTiming: parseTransformRevertTiming(record.values.revertTiming, "revertTiming", source)
      },
      cardDefinitions,
      source
    );

    if (seenRuleIds.has(rule.ruleId)) {
      throw new Error(`${source} duplicates ruleId "${rule.ruleId}".`);
    }

    seenRuleIds.add(rule.ruleId);
    rules.push(rule);
  }

  return rules;
}

function parseTransformRulesJson(
  value: unknown,
  cardDefinitions: Record<string, CardDefinition>,
  source: string
): CardTransformRule[] {
  if (!Array.isArray(value)) {
    throw new Error(`${source} must be an array.`);
  }

  const seenRuleIds = new Set<string>();

  return value.map((rawRule, index) => {
    const ruleSource = `${source}[${index}]`;
    const record = readRecord(rawRule, ruleSource);
    const rule = validateTransformRule(
      {
        ruleId: readRequiredString(record.ruleId, "ruleId", ruleSource),
        triggerCardId: readRequiredString(record.triggerCardId, "triggerCardId", ruleSource),
        sourceCardId: readRequiredString(record.sourceCardId, "sourceCardId", ruleSource),
        targetCardId: readRequiredString(record.targetCardId, "targetCardId", ruleSource),
        scope: parseTransformScope(record.scope, "scope", ruleSource),
        reversible: parseBoolean(record.reversible, "reversible", ruleSource),
        revertTiming: parseTransformRevertTiming(record.revertTiming, "revertTiming", ruleSource)
      },
      cardDefinitions,
      ruleSource
    );

    if (seenRuleIds.has(rule.ruleId)) {
      throw new Error(`${ruleSource} duplicates ruleId "${rule.ruleId}".`);
    }

    seenRuleIds.add(rule.ruleId);
    return rule;
  });
}

function parseRacesCsv(csvText: string): Record<string, RaceDefinition> {
  const records = parseCsvRecords(
    csvText,
    [
      "raceId",
      "name",
      "baseHp",
      "naturalArmorType",
      "naturalArmorValue",
      "strengthCreationMax",
      "dexterityCreationMax",
      "intelligenceCreationMax",
      "wisdomCreationMax",
      "charismaCreationMax",
      "constitutionCreationMax",
      "strengthLevelMax",
      "dexterityLevelMax",
      "intelligenceLevelMax",
      "wisdomLevelMax",
      "charismaLevelMax",
      "constitutionLevelMax",
      "enabled"
    ],
    "races.csv"
  );
  const races: Record<string, RaceDefinition> = {};

  for (const record of records) {
    if (!isEnabled(record.values.enabled)) {
      continue;
    }

    const source = `races.csv row ${record.rowNumber}`;
    const race = validateRaceDefinition(
      {
        raceId: readRequiredString(record.values.raceId, "raceId", source),
        name: readRequiredString(record.values.name, "name", source),
        creationMax: parseAbilityScoresFromRecord(record.values, "CreationMax", source),
        levelMax: parseAbilityScoresFromRecord(record.values, "LevelMax", source),
        baseHp: parseInteger(record.values.baseHp, "baseHp", source, 1),
        naturalArmorType: parseNaturalArmorType(record.values.naturalArmorType, "naturalArmorType", source),
        naturalArmorValue: parseInteger(record.values.naturalArmorValue, "naturalArmorValue", source, 0)
      },
      source
    );

    if (races[race.raceId]) {
      throw new Error(`${source} duplicates raceId "${race.raceId}".`);
    }

    races[race.raceId] = race;
  }

  if (Object.keys(races).length === 0) {
    throw new Error("races.csv must contain at least one enabled race.");
  }

  return races;
}

function parseRacesJson(value: unknown, source: string): Record<string, RaceDefinition> {
  const record = readRecord(value, source);
  const races: Record<string, RaceDefinition> = {};

  for (const [raceId, rawRace] of Object.entries(record)) {
    const raceSource = `${source}.${raceId}`;
    const raceRecord = readRecord(rawRace, raceSource);
    const race = validateRaceDefinition(
      {
        raceId: readRequiredString(raceRecord.raceId, "raceId", raceSource),
        name: readRequiredString(raceRecord.name, "name", raceSource),
        creationMax: parseAbilityScoresJson(raceRecord.creationMax, `${raceSource}.creationMax`),
        levelMax: parseAbilityScoresJson(raceRecord.levelMax, `${raceSource}.levelMax`),
        baseHp: parseInteger(raceRecord.baseHp, "baseHp", raceSource, 1),
        naturalArmorType: parseNaturalArmorType(raceRecord.naturalArmorType, "naturalArmorType", raceSource),
        naturalArmorValue: parseInteger(raceRecord.naturalArmorValue, "naturalArmorValue", raceSource, 0)
      },
      raceSource
    );

    if (race.raceId !== raceId) {
      throw new Error(`${raceSource}.raceId must match its catalog key.`);
    }

    races[raceId] = race;
  }

  if (Object.keys(races).length === 0) {
    throw new Error(`${source} must contain at least one race.`);
  }

  return races;
}

function parseCardDefinitionRecord(
  record: Record<string, unknown>,
  source: string
): CardDefinition {
  const effect = parseEffect(record, source);
  const actionTags = parseActionTagsRecord(record, source);
  const resourceCosts = parseResourceCostsRecord(record, source);

  return {
    cardId: readRequiredString(record.cardId, "cardId", source),
    name: readRequiredString(record.name, "name", source),
    cost: parseInteger(record.cost, "cost", source, 0),
    type: parseCardType(record.type, source),
    description: readRequiredString(record.description, "description", source),
    effect,
    targeting: parseTargetingRecord(record, effect, source),
    consumable: parseOptionalBoolean(record.consumable, "consumable", source),
    ...(resourceCosts ? { resourceCosts } : {}),
    ...(actionTags.length > 0 ? { actionTags } : {})
  };
}

function parseCardDefinitionJsonRecord(
  record: Record<string, unknown>,
  source: string
): CardDefinition {
  const effect = parseEffectJson(record.effect, `${source}.effect`);
  const actionTags = parseActionTagsJson(record.actionTags, `${source}.actionTags`);
  const resourceCosts = parseResourceCostsJson(record, source);

  return {
    cardId: readRequiredString(record.cardId, "cardId", source),
    name: readRequiredString(record.name, "name", source),
    cost: parseInteger(record.cost, "cost", source, 0),
    type: parseCardType(record.type, source),
    description: readRequiredString(record.description, "description", source),
    effect,
    targeting: parseTargetingJson(record.targeting, effect, `${source}.targeting`),
    consumable: parseOptionalBoolean(record.consumable, "consumable", source),
    ...(resourceCosts ? { resourceCosts } : {}),
    ...(actionTags.length > 0 ? { actionTags } : {})
  };
}

function parseResourceCostsRecord(
  record: Record<string, unknown>,
  source: string
): CardResourceCosts | undefined {
  const consumeCardCount = parseOptionalInteger(
    record.consumeCardCount ?? record.consumeCards,
    "consumeCardCount",
    source,
    0
  );
  const hp = parseOptionalInteger(record.hpCost ?? record.hp, "hpCost", source, 0);

  return createResourceCosts(consumeCardCount, hp);
}

function parseResourceCostsJson(
  record: Record<string, unknown>,
  source: string
): CardResourceCosts | undefined {
  const nestedCosts = record.resourceCosts === undefined || record.resourceCosts === null
    ? {}
    : readRecord(record.resourceCosts, `${source}.resourceCosts`);
  const consumeCardCount = parseOptionalInteger(
    nestedCosts.consumeCardCount ?? record.consumeCardCount ?? record.consumeCards,
    "consumeCardCount",
    source,
    0
  );
  const hp = parseOptionalInteger(
    nestedCosts.hp ?? record.hpCost ?? record.hp,
    "hp",
    source,
    0
  );

  return createResourceCosts(consumeCardCount, hp);
}

function createResourceCosts(
  consumeCardCount?: number,
  hp?: number
): CardResourceCosts | undefined {
  const resourceCosts: CardResourceCosts = {};

  if (consumeCardCount && consumeCardCount > 0) {
    resourceCosts.consumeCardCount = consumeCardCount;
  }

  if (hp && hp > 0) {
    resourceCosts.hp = hp;
  }

  return Object.keys(resourceCosts).length > 0 ? resourceCosts : undefined;
}

function parseEffect(record: Record<string, unknown>, source: string): CardEffectDefinition {
  const effectType = parseEffectType(record.effectType, "effectType", source);

  if (effectType === "NONE") {
    return { type: "NONE" };
  }

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

  if (effectType === "NONE") {
    return { type: "NONE" };
  }

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

function parseActionTagsRecord(record: Record<string, unknown>, source: string): CardActionTag[] {
  const rawTags = readOptionalString(record.actionTags) || readOptionalString(record.tags);
  if (!rawTags) {
    return [];
  }

  const tagValues = rawTags
    .split(/[|;、]/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return validateUniqueActionTags(
    tagValues.map((value, index) =>
      createActionTag(parseActionTagType(value, `actionTags[${index}]`, source))
    ),
    source
  );
}

function parseActionTagsJson(value: unknown, source: string): CardActionTag[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${source} must be an array.`);
  }

  return validateUniqueActionTags(
    value.map((rawTag, index) => {
      const tagSource = `${source}[${index}]`;
      if (typeof rawTag === "string") {
        return createActionTag(parseActionTagType(rawTag, "type", tagSource));
      }

      const record = readRecord(rawTag, tagSource);
      return createActionTag(parseActionTagType(record.type, "type", tagSource));
    }),
    source
  );
}

function validateUniqueActionTags(actionTags: CardActionTag[], source: string): CardActionTag[] {
  const seenTypes = new Set<CardActionTagType>();

  for (const tag of actionTags) {
    if (seenTypes.has(tag.type)) {
      throw new Error(`${source} duplicates action tag "${tag.type}".`);
    }

    seenTypes.add(tag.type);
  }

  return actionTags;
}

function createActionTag(type: CardActionTagType): CardActionTag {
  switch (type) {
    case "BONUS_ACTION":
      return {
        type,
        label: "附贈動作",
        trigger: "DISCARD"
      };
    case "REACTION_ACTION":
      return {
        type,
        label: "反應動作",
        trigger: "DAMAGE_TARGETED"
      };
    case "COUNTER_ACTION":
      return {
        type,
        label: "反制動作",
        trigger: "SKILL_TARGETED"
      };
    case "READY_ACTION":
      return {
        type,
        label: "準備動作",
        trigger: "TURN_STARTED"
      };
  }
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

function validateTransformRule(
  rule: CardTransformRule,
  cardDefinitions: Record<string, CardDefinition>,
  source: string
): CardTransformRule {
  if (rule.sourceCardId === rule.targetCardId) {
    throw new Error(`${source} targetCardId must be different from sourceCardId.`);
  }

  if (!cardDefinitions[rule.triggerCardId]) {
    throw new Error(`${source} triggerCardId references unknown cardId "${rule.triggerCardId}".`);
  }

  if (!cardDefinitions[rule.sourceCardId]) {
    throw new Error(`${source} sourceCardId references unknown cardId "${rule.sourceCardId}".`);
  }

  if (!cardDefinitions[rule.targetCardId]) {
    throw new Error(`${source} targetCardId references unknown cardId "${rule.targetCardId}".`);
  }

  if (!rule.reversible && rule.revertTiming !== "NEVER") {
    throw new Error(`${source} revertTiming must be NEVER when reversible is false.`);
  }

  return rule;
}

function parseCardType(value: unknown, source: string): CardType {
  const cardType = readRequiredString(value, "type", source).toUpperCase();

  if (!CARD_TYPES.has(cardType)) {
    throw new Error(`${source} type must be ATTACK, SKILL, MAGE, ITEM, or STATUS.`);
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
    throw new Error(`${source} ${field} must be NONE, DAMAGE, HEAL, or DRAW.`);
  }

  return effectType as CardEffectDefinition["type"];
}

function parseActionTagType(value: unknown, field: string, source: string): CardActionTagType {
  const rawType = readRequiredString(value, field, source).toUpperCase().replaceAll("-", "_").replaceAll(" ", "_");
  const normalizedType = normalizeActionTagType(rawType);

  if (!ACTION_TAG_TYPES.has(normalizedType)) {
    throw new Error(`${source} ${field} must be BONUS_ACTION, REACTION_ACTION, COUNTER_ACTION, or READY_ACTION.`);
  }

  return normalizedType as CardActionTagType;
}

function normalizeActionTagType(value: string): string {
  switch (value) {
    case "附贈動作":
    case "BONUS":
      return "BONUS_ACTION";
    case "反應動作":
    case "REACTION":
      return "REACTION_ACTION";
    case "反制動作":
    case "COUNTER":
      return "COUNTER_ACTION";
    case "準備動作":
    case "READY":
    case "PREPARE":
    case "PREPARED_ACTION":
      return "READY_ACTION";
    default:
      return value;
  }
}

function parseTransformScope(
  value: unknown,
  field: string,
  source: string
): CardTransformScope {
  const scope = readRequiredString(value, field, source).toUpperCase();
  const normalizedScope = scope === "HAND" ? "OWNER_HAND" : scope;

  if (!TRANSFORM_SCOPES.has(normalizedScope)) {
    throw new Error(`${source} ${field} must be HAND or OWNER_HAND.`);
  }

  return normalizedScope as CardTransformScope;
}

function parseTransformRevertTiming(
  value: unknown,
  field: string,
  source: string
): CardTransformRevertTiming {
  const timing = readOptionalString(value).toUpperCase();
  const normalizedTiming = timing === "" || timing === "NONE" ? "NEVER" : timing;

  if (!TRANSFORM_REVERT_TIMINGS.has(normalizedTiming)) {
    throw new Error(`${source} ${field} must be NEVER or TURN_END.`);
  }

  return normalizedTiming as CardTransformRevertTiming;
}

function parseNaturalArmorType(value: unknown, field: string, source: string): NaturalArmorType {
  const armorType = readRequiredString(value, field, source).toUpperCase();

  if (!NATURAL_ARMOR_TYPES.has(armorType)) {
    throw new Error(`${source} ${field} must be NONE, FUR, SHELL, or SKIN.`);
  }

  return armorType as NaturalArmorType;
}

function parseAbilityScoresFromRecord(
  record: Record<string, unknown>,
  suffix: "CreationMax" | "LevelMax",
  source: string
): AbilityScores {
  return {
    strength: parseInteger(record[`strength${suffix}`], `strength${suffix}`, source, CREATION_ABILITY_MIN),
    dexterity: parseInteger(record[`dexterity${suffix}`], `dexterity${suffix}`, source, CREATION_ABILITY_MIN),
    intelligence: parseInteger(record[`intelligence${suffix}`], `intelligence${suffix}`, source, CREATION_ABILITY_MIN),
    wisdom: parseInteger(record[`wisdom${suffix}`], `wisdom${suffix}`, source, CREATION_ABILITY_MIN),
    charisma: parseInteger(record[`charisma${suffix}`], `charisma${suffix}`, source, CREATION_ABILITY_MIN),
    constitution: parseInteger(record[`constitution${suffix}`], `constitution${suffix}`, source, CREATION_ABILITY_MIN)
  };
}

function parseAbilityScoresJson(value: unknown, source: string): AbilityScores {
  const record = readRecord(value, source);
  return {
    strength: parseInteger(record.strength, "strength", source, CREATION_ABILITY_MIN),
    dexterity: parseInteger(record.dexterity, "dexterity", source, CREATION_ABILITY_MIN),
    intelligence: parseInteger(record.intelligence, "intelligence", source, CREATION_ABILITY_MIN),
    wisdom: parseInteger(record.wisdom, "wisdom", source, CREATION_ABILITY_MIN),
    charisma: parseInteger(record.charisma, "charisma", source, CREATION_ABILITY_MIN),
    constitution: parseInteger(record.constitution, "constitution", source, CREATION_ABILITY_MIN)
  };
}

function validateRaceDefinition(race: RaceDefinition, source: string): RaceDefinition {
  for (const ability of ABILITY_KEYS) {
    if (race.levelMax[ability] < race.creationMax[ability]) {
      throw new Error(`${source} ${ability}LevelMax must be >= ${ability}CreationMax.`);
    }
  }

  return race;
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

function parseOptionalBoolean(value: unknown, field: string, source: string): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "boolean" && readOptionalString(value) === "") {
    return undefined;
  }

  return parseBoolean(value, field, source);
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

function parseOptionalInteger(
  value: unknown,
  field: string,
  source: string,
  min: number
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (readOptionalString(value) === "") {
    return undefined;
  }

  return parseInteger(value, field, source, min);
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
