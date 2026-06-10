import type { CardDefinition } from "./card.js";

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
};
