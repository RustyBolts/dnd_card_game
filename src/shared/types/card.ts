export type CardType = "ATTACK" | "SKILL" | "MAGE" | "ITEM" | "STATUS";

export type CardZone =
  | "DECK"
  | "HAND"
  | "BOARD"
  | "PREPARED"
  | "RESOLVING"
  | "TEMPORARY"
  | "EXHAUST"
  | "GRAVEYARD"
  | "EXILE";

export type CardEffectDefinition =
  | { type: "NONE" }
  | { type: "DAMAGE"; value: number }
  | { type: "HEAL"; value: number }
  | { type: "DRAW"; count: number };

export type CardTargetSelection = "NONE" | "SINGLE" | "GROUP";

export type CardTargetScope = "SELF" | "ALLY" | "ENEMY" | "ANY";

export type CardTargeting = {
  selection: CardTargetSelection;
  scope: CardTargetScope;
  requiresTarget: boolean;
};

export type CardActionTagType =
  | "BONUS_ACTION"
  | "REACTION_ACTION"
  | "COUNTER_ACTION"
  | "READY_ACTION";

export type CardActionTrigger =
  | "DISCARD"
  | "DAMAGE_TARGETED"
  | "SKILL_TARGETED"
  | "MAGE_TARGETED"
  | "TURN_STARTED";

export type CardActionTag = {
  type: CardActionTagType;
  label: string;
  trigger: CardActionTrigger;
};

export type CardResourceCosts = {
  consumeCardCount?: number;
  hp?: number;
};

export type CardDefinition = {
  cardId: string;
  name: string;
  cost: number;
  type: CardType;
  description: string;
  effect: CardEffectDefinition;
  targeting: CardTargeting;
  consumable?: boolean;
  resourceCosts?: CardResourceCosts;
  actionTags?: CardActionTag[];
};

export type CardInstance = {
  instanceId: string;
  cardId: string;
  ownerId: string;
  zone: CardZone;
  preparedTargetIds?: string[];
};

export type VisibleCardInstance = CardInstance & {
  name?: string;
  cost?: number;
  type?: CardType;
  description?: string;
  effect?: CardEffectDefinition;
  targeting?: CardTargeting;
  consumable?: boolean;
  resourceCosts?: CardResourceCosts;
  actionTags?: CardActionTag[];
  hidden?: boolean;
};
