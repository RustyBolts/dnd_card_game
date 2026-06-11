import type { CardDefinition } from "./card.js";
import type { RaceDefinition } from "./character.js";

export type CardTransformScope = "OWNER_HAND";

export type CardTransformRevertTiming = "NEVER" | "TURN_END";

export type CardTransformRule = {
  ruleId: string;
  triggerCardId: string;
  sourceCardId: string;
  targetCardId: string;
  scope: CardTransformScope;
  reversible: boolean;
  revertTiming: CardTransformRevertTiming;
};

export type CardCatalog = {
  version: string;
  cardDefinitions: Record<string, CardDefinition>;
  starterDeckCardIds: string[];
  transformRules: CardTransformRule[];
  races?: Record<string, RaceDefinition>;
};
