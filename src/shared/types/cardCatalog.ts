import type { CardDefinition } from "./card.js";

export type CardCatalog = {
  version: string;
  cardDefinitions: Record<string, CardDefinition>;
  starterDeckCardIds: string[];
};
