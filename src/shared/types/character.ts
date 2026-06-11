export const ABILITY_KEYS = [
  "strength",
  "dexterity",
  "intelligence",
  "wisdom",
  "charisma",
  "constitution"
] as const;

export type AbilityKey = (typeof ABILITY_KEYS)[number];

export type AbilityScores = Record<AbilityKey, number>;

export type AbilityModifiers = Record<AbilityKey, number>;

export type NaturalArmorType = "NONE" | "FUR" | "SHELL" | "SKIN";

export type RaceDefinition = {
  raceId: string;
  name: string;
  creationMax: AbilityScores;
  levelMax: AbilityScores;
  baseHp: number;
  naturalArmorType: NaturalArmorType;
  naturalArmorValue: number;
};

export type CharacterConfig = {
  raceId: string;
  abilityScores: AbilityScores;
};

export type CharacterState = CharacterConfig & {
  abilityModifiers: AbilityModifiers;
  baseHp: number;
  maxHp: number;
  naturalArmorType: NaturalArmorType;
  naturalArmorValue: number;
};
