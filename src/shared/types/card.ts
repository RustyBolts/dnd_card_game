export type CardType = "ATTACK" | "SKILL" | "ITEM" | "STATUS";

export type CardZone = "DECK" | "HAND" | "BOARD" | "GRAVEYARD" | "EXILE";

export type CardEffectDefinition =
  | { type: "DAMAGE"; value: number }
  | { type: "HEAL"; value: number }
  | { type: "DRAW"; count: number };

export type CardDefinition = {
  cardId: string;
  name: string;
  cost: number;
  type: CardType;
  description: string;
  effect: CardEffectDefinition;
};

export type CardInstance = {
  instanceId: string;
  cardId: string;
  ownerId: string;
  zone: CardZone;
};

export type VisibleCardInstance = CardInstance & {
  name?: string;
  cost?: number;
  type?: CardType;
  description?: string;
  effect?: CardEffectDefinition;
  hidden?: boolean;
};
