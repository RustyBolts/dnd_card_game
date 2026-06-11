import {
  ABILITY_KEYS,
  type AbilityModifiers,
  type AbilityScores,
  type CharacterConfig,
  type CharacterState,
  type NaturalArmorType,
  type RaceDefinition
} from "../types/character.js";

export const CREATION_ABILITY_MIN = 8;
export const DEFAULT_CREATION_ABILITY_MAX = 15;
export const DEFAULT_LEVEL_ABILITY_MAX = 20;
export const CREATION_POINT_BUDGET = 24;

export const DEFAULT_ABILITY_SCORES: AbilityScores = {
  strength: CREATION_ABILITY_MIN,
  dexterity: CREATION_ABILITY_MIN,
  intelligence: CREATION_ABILITY_MIN,
  wisdom: CREATION_ABILITY_MIN,
  charisma: CREATION_ABILITY_MIN,
  constitution: CREATION_ABILITY_MIN
};

const DEFAULT_CREATION_MAX: AbilityScores = {
  strength: DEFAULT_CREATION_ABILITY_MAX,
  dexterity: DEFAULT_CREATION_ABILITY_MAX,
  intelligence: DEFAULT_CREATION_ABILITY_MAX,
  wisdom: DEFAULT_CREATION_ABILITY_MAX,
  charisma: DEFAULT_CREATION_ABILITY_MAX,
  constitution: DEFAULT_CREATION_ABILITY_MAX
};

const DEFAULT_LEVEL_MAX: AbilityScores = {
  strength: DEFAULT_LEVEL_ABILITY_MAX,
  dexterity: DEFAULT_LEVEL_ABILITY_MAX,
  intelligence: DEFAULT_LEVEL_ABILITY_MAX,
  wisdom: DEFAULT_LEVEL_ABILITY_MAX,
  charisma: DEFAULT_LEVEL_ABILITY_MAX,
  constitution: DEFAULT_LEVEL_ABILITY_MAX
};

export const DEFAULT_RACES: Record<string, RaceDefinition> = {
  human: createRaceDefinition({
    raceId: "human",
    name: "人類",
    creationMaxOverrides: {
      strength: 18,
      dexterity: 18,
      intelligence: 18,
      wisdom: 18,
      charisma: 18,
      constitution: 18
    },
    baseHp: 20,
    naturalArmorType: "NONE",
    naturalArmorValue: 0
  }),
  gnome: createRaceDefinition({
    raceId: "gnome",
    name: "地侏",
    creationMaxOverrides: {
      dexterity: 18,
      intelligence: 20,
      wisdom: 20,
      charisma: 18
    },
    baseHp: 20,
    naturalArmorType: "SKIN",
    naturalArmorValue: 0
  }),
  orc: createRaceDefinition({
    raceId: "orc",
    name: "獸人",
    creationMaxOverrides: {
      strength: 20,
      dexterity: 18,
      constitution: 20
    },
    baseHp: 25,
    naturalArmorType: "FUR",
    naturalArmorValue: 0
  })
};

export function createRaceDefinition(input: {
  raceId: string;
  name: string;
  creationMaxOverrides?: Partial<AbilityScores>;
  levelMaxOverrides?: Partial<AbilityScores>;
  baseHp: number;
  naturalArmorType: NaturalArmorType;
  naturalArmorValue: number;
}): RaceDefinition {
  return {
    raceId: input.raceId,
    name: input.name,
    creationMax: {
      ...DEFAULT_CREATION_MAX,
      ...input.creationMaxOverrides
    },
    levelMax: {
      ...DEFAULT_LEVEL_MAX,
      ...input.levelMaxOverrides
    },
    baseHp: input.baseHp,
    naturalArmorType: input.naturalArmorType,
    naturalArmorValue: input.naturalArmorValue
  };
}

export function createDefaultCharacterConfig(raceId = "human"): CharacterConfig {
  return {
    raceId,
    abilityScores: {
      strength: 14,
      dexterity: 12,
      intelligence: 12,
      wisdom: 12,
      charisma: 12,
      constitution: 10
    }
  };
}

export function validateAndCreateCharacter(
  config: CharacterConfig,
  races: Record<string, RaceDefinition>
): CharacterState {
  const race = races[config.raceId];
  if (!race) {
    throw new Error(`Unknown raceId "${config.raceId}".`);
  }

  assertCompleteAbilityScores(config.abilityScores);

  for (const ability of ABILITY_KEYS) {
    const value = config.abilityScores[ability];
    if (!Number.isInteger(value)) {
      throw new Error(`${ability} must be an integer.`);
    }

    if (value < CREATION_ABILITY_MIN) {
      throw new Error(`${ability} must be at least ${CREATION_ABILITY_MIN}.`);
    }

    if (value > race.creationMax[ability]) {
      throw new Error(`${ability} exceeds ${race.name} creation max ${race.creationMax[ability]}.`);
    }
  }

  const spentPoints = calculateCreationPointSpend(config.abilityScores);
  if (spentPoints !== CREATION_POINT_BUDGET) {
    throw new Error(`Character must spend exactly ${CREATION_POINT_BUDGET} ability points.`);
  }

  const abilityModifiers = calculateAbilityModifiers(config.abilityScores);
  const maxHp = race.baseHp + abilityModifiers.constitution;

  return {
    raceId: race.raceId,
    abilityScores: { ...config.abilityScores },
    abilityModifiers,
    baseHp: race.baseHp,
    maxHp,
    naturalArmorType: race.naturalArmorType,
    naturalArmorValue: race.naturalArmorValue
  };
}

export function calculateCreationPointSpend(scores: AbilityScores): number {
  return ABILITY_KEYS.reduce((total, ability) => total + scores[ability] - CREATION_ABILITY_MIN, 0);
}

export function calculateAbilityModifiers(scores: AbilityScores): AbilityModifiers {
  return {
    strength: calculateAbilityModifier(scores.strength),
    dexterity: calculateAbilityModifier(scores.dexterity),
    intelligence: calculateAbilityModifier(scores.intelligence),
    wisdom: calculateAbilityModifier(scores.wisdom),
    charisma: calculateAbilityModifier(scores.charisma),
    constitution: calculateAbilityModifier(scores.constitution)
  };
}

export function calculateAbilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

function assertCompleteAbilityScores(scores: AbilityScores): void {
  for (const ability of ABILITY_KEYS) {
    if (scores[ability] === undefined) {
      throw new Error(`${ability} is required.`);
    }
  }
}
