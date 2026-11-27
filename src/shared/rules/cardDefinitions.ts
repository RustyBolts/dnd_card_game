import type { CardDefinition } from "../types/card.js";
import type { CardCatalog } from "../types/cardCatalog.js";
import { loadoutSourceKey } from "../types/loadout.js";
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
  },
  disarm: {
    cardId: "disarm",
    name: "繳械",
    cost: 1,
    type: "ATTACK",
    description: "指定一名敵人，使其隨機一件武器脫手。",
    effect: { type: "DISARM_RANDOM_WEAPON" },
    targeting: { selection: "SINGLE", scope: "ENEMY", requiresTarget: true }
  },
  charge: {
    cardId: "charge",
    name: "衝鋒",
    cost: 1,
    type: "ATTACK",
    description: "對一名目標造成 2 點傷害。",
    effect: { type: "DAMAGE", value: 2 },
    targeting: { selection: "SINGLE", scope: "ENEMY", requiresTarget: true }
  },
  punch: {
    cardId: "punch",
    name: "拳擊",
    cost: 0,
    type: "ATTACK",
    description: "對一名目標造成 1 點傷害。",
    effect: { type: "DAMAGE", value: 1 },
    targeting: { selection: "SINGLE", scope: "ENEMY", requiresTarget: true }
  },
  feint: {
    cardId: "feint",
    name: "佯攻",
    cost: 1,
    type: "SKILL",
    description: "使一名目標失去 1 點能量。",
    effect: { type: "LOSE_ENERGY", value: 1 },
    targeting: { selection: "SINGLE", scope: "ENEMY", requiresTarget: true }
  },
  slash: {
    cardId: "slash",
    name: "揮砍",
    cost: 1,
    type: "ATTACK",
    description: "對一名目標造成 2 點傷害。",
    effect: { type: "DAMAGE", value: 2 },
    targeting: { selection: "SINGLE", scope: "ENEMY", requiresTarget: true }
  },
  thrust: {
    cardId: "thrust",
    name: "突刺",
    cost: 1,
    type: "ATTACK",
    description: "對一名目標造成 2 點傷害。",
    effect: { type: "DAMAGE", value: 2 },
    targeting: { selection: "SINGLE", scope: "ENEMY", requiresTarget: true }
  },
  longsword: {
    cardId: "longsword",
    name: "長劍",
    cost: 0,
    type: "ITEM",
    description: "重新裝備脫手的長劍，恢復長劍相關卡牌。",
    effect: { type: "REEQUIP_WEAPON" },
    targeting: { selection: "NONE", scope: "SELF", requiresTarget: false },
    consumable: true
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
  hiddenDeckCardIds: {
    NATURE: [],
    KNOWLEDGE: [],
    ENVIRONMENT: []
  },
  transformRules: [],
  races: DEFAULT_RACES,
  loadoutSources: {
    [loadoutSourceKey("CLASS", "fighter")]: {
      sourceType: "CLASS",
      sourceId: "fighter",
      name: "戰士"
    },
    [loadoutSourceKey("FEAT", "brawler")]: {
      sourceType: "FEAT",
      sourceId: "brawler",
      name: "鬥毆高手"
    },
    [loadoutSourceKey("WEAPON", "longsword")]: {
      sourceType: "WEAPON",
      sourceId: "longsword",
      name: "長劍",
      recoveryCardId: "longsword"
    }
  },
  loadoutCards: [
    { sourceType: "CLASS", sourceId: "fighter", cardId: "disarm", count: 2 },
    { sourceType: "CLASS", sourceId: "fighter", cardId: "charge", count: 3 },
    { sourceType: "FEAT", sourceId: "brawler", cardId: "punch", count: 3 },
    { sourceType: "FEAT", sourceId: "brawler", cardId: "feint", count: 2 },
    { sourceType: "WEAPON", sourceId: "longsword", cardId: "slash", count: 3 },
    { sourceType: "WEAPON", sourceId: "longsword", cardId: "thrust", count: 2 }
  ]
};
