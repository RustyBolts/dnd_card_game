import type {
  CardDefinition,
  CardEffectDefinition,
  CardTargeting
} from "../types/card.js";
import type { GameState, PlayerState } from "../types/game.js";

type TargetState = Pick<GameState, "playerOrder" | "players">;
type TargetableCardDefinition = Partial<Pick<CardDefinition, "effect">> & {
  targeting?: CardTargeting;
};

export function defaultTargetingForEffect(effect: CardEffectDefinition): CardTargeting {
  if (effect.type === "DAMAGE") {
    return {
      selection: "SINGLE",
      scope: "ENEMY",
      requiresTarget: true
    };
  }

  return {
    selection: "NONE",
    scope: "SELF",
    requiresTarget: false
  };
}

export function getCardTargeting(definition: TargetableCardDefinition): CardTargeting {
  if (definition.targeting) {
    return definition.targeting;
  }

  if (definition.effect) {
    return defaultTargetingForEffect(definition.effect);
  }

  return {
    selection: "NONE",
    scope: "SELF",
    requiresTarget: false
  };
}

export function getImplicitTargetId(targeting: CardTargeting, playerId: string): string | undefined {
  if (!targeting.requiresTarget && targeting.scope === "SELF") {
    return playerId;
  }

  return undefined;
}

export function getSelectableTargetIds(
  state: TargetState,
  playerId: string,
  targeting: CardTargeting
): string[] {
  if (!targeting.requiresTarget || targeting.selection !== "SINGLE") {
    return [];
  }

  return state.playerOrder.filter((targetId) =>
    isPlayerTargetAllowed(state, playerId, targetId, targeting)
  );
}

export function isPlayerTargetAllowed(
  state: TargetState,
  playerId: string,
  targetId: string,
  targeting: CardTargeting
): boolean {
  if (!state.players[targetId]) {
    return false;
  }

  switch (targeting.scope) {
    case "SELF":
      return targetId === playerId;
    case "ALLY":
      return isAlly(state.players[playerId], state.players[targetId], playerId, targetId);
    case "ENEMY":
      return isEnemy(state.players[playerId], state.players[targetId], playerId, targetId);
    case "ANY":
      return true;
  }
}

function isAlly(
  player: PlayerState | undefined,
  target: PlayerState | undefined,
  playerId: string,
  targetId: string
): boolean {
  if (!player || !target || playerId === targetId) {
    return false;
  }

  return Boolean(player.teamId && player.teamId === target.teamId);
}

function isEnemy(
  player: PlayerState | undefined,
  target: PlayerState | undefined,
  playerId: string,
  targetId: string
): boolean {
  if (!player || !target || playerId === targetId) {
    return false;
  }

  if (player.teamId || target.teamId) {
    return player.teamId !== target.teamId;
  }

  return true;
}
