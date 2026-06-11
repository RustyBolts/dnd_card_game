import type { CardDefinition } from "../types/card.js";
import type { CardCatalog } from "../types/cardCatalog.js";
import { DEFAULT_RACES } from "./characterRules.js";

export const CARD_DEFINITIONS: Record<string, CardDefinition> = {
  fireball: {
    cardId: "fireball",
    name: "火球術",
    cost: 2,
    type: "ATTACK",
    description: "對一名目標造成 3 點傷害。",
    effect: { type: "DAMAGE", value: 3 },
    targeting: { selection: "SINGLE", scope: "ENEMY", requiresTarget: true }
  },
  dagger_strike: {
    cardId: "dagger_strike",
    name: "短刃突襲",
    cost: 1,
    type: "ATTACK",
    description: "對一名目標造成 1 點傷害。",
    effect: { type: "DAMAGE", value: 1 },
    targeting: { selection: "SINGLE", scope: "ENEMY", requiresTarget: true }
  },
  healing_potion: {
    cardId: "healing_potion",
    name: "治療藥水",
    cost: 1,
    type: "ITEM",
    description: "恢復自己 3 點 HP。",
    effect: { type: "HEAL", value: 3 },
    targeting: { selection: "NONE", scope: "SELF", requiresTarget: false }
  },
  tactical_insight: {
    cardId: "tactical_insight",
    name: "戰術洞察",
    cost: 1,
    type: "SKILL",
    description: "抽 2 張牌。",
    effect: { type: "DRAW", count: 2 },
    targeting: { selection: "NONE", scope: "SELF", requiresTarget: false }
  },
  mana_spark: {
    cardId: "mana_spark",
    name: "魔力火花",
    cost: 0,
    type: "SKILL",
    description: "對一名目標造成 1 點傷害。",
    effect: { type: "DAMAGE", value: 1 },
    targeting: { selection: "SINGLE", scope: "ENEMY", requiresTarget: true }
  }
};

export const STARTER_DECK_CARD_IDS = [
  "fireball",
  "fireball",
  "fireball",
  "dagger_strike",
  "dagger_strike",
  "dagger_strike",
  "healing_potion",
  "healing_potion",
  "tactical_insight",
  "tactical_insight",
  "mana_spark",
  "mana_spark"
];

export const DEFAULT_CARD_CATALOG: CardCatalog = {
  version: "local-default-2026-06-05",
  cardDefinitions: CARD_DEFINITIONS,
  starterDeckCardIds: STARTER_DECK_CARD_IDS,
  transformRules: [],
  races: DEFAULT_RACES
};
