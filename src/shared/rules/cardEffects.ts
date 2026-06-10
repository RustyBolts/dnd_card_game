import type {
  CardDefinition,
  CardEffectDefinition,
  CardInstance
} from "../types/card.js";
import type {
  CardDrawnEvent,
  DamageAppliedEvent,
  GameEndedEvent,
  HealAppliedEvent
} from "../types/network.js";
import type { GameState } from "../types/game.js";

export type DrawCardsFn = (
  playerId: string,
  count: number
) => CardDrawnEvent[];

export type EffectContext = {
  state: GameState;
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  playerId: string;
  targetId?: string;
  targetIds?: string[];
  nextSeq: () => number;
  drawCards: DrawCardsFn;
};

export type EffectEvent =
  | DamageAppliedEvent
  | HealAppliedEvent
  | CardDrawnEvent
  | GameEndedEvent;

export function resolveCardEffect(context: EffectContext): EffectEvent[] {
  const effect = context.sourceDefinition.effect;

  if (effect.type === "DAMAGE") {
    return resolveDamage(effect, context);
  }

  if (effect.type === "HEAL") {
    return resolveHeal(effect, context);
  }

  if (effect.type === "NONE") {
    return [];
  }

  return context.drawCards(context.playerId, effect.count);
}

function resolveDamage(
  effect: Extract<CardEffectDefinition, { type: "DAMAGE" }>,
  context: EffectContext
): EffectEvent[] {
  const targetIds = getTargetIds(context);
  if (targetIds.length === 0) {
    throw new Error("No valid target for damage effect.");
  }

  const events: EffectEvent[] = [];
  let defeatedTargetId: string | null = null;

  for (const targetId of targetIds) {
    const target = context.state.players[targetId];
    if (!target) {
      throw new Error(`Target player ${targetId} does not exist.`);
    }

    target.hp = Math.max(0, target.hp - effect.value);
    events.push({
      type: "DAMAGE_APPLIED",
      seq: context.nextSeq(),
      payload: {
        sourceId: context.sourceCard.instanceId,
        targetId,
        amount: effect.value,
        hpAfter: target.hp
      }
    });

    if (target.hp <= 0) {
      defeatedTargetId ??= targetId;
    }
  }

  if (defeatedTargetId) {
    context.state.status = "ENDED";
    context.state.winnerId = context.playerId;
    events.push({
      type: "GAME_ENDED",
      seq: context.nextSeq(),
      payload: {
        winnerId: context.playerId
      }
    });
  }

  return events;
}

function resolveHeal(
  effect: Extract<CardEffectDefinition, { type: "HEAL" }>,
  context: EffectContext
): HealAppliedEvent[] {
  const targetIds = getTargetIds(context);
  if (targetIds.length === 0) {
    throw new Error("No valid target for heal effect.");
  }

  return targetIds.map((targetId) => {
    const target = context.state.players[targetId];
    if (!target) {
      throw new Error(`Target player ${targetId} does not exist.`);
    }

    target.hp = Math.min(20, target.hp + effect.value);
    return {
      type: "HEAL_APPLIED",
      seq: context.nextSeq(),
      payload: {
        sourceId: context.sourceCard.instanceId,
        targetId,
        amount: effect.value,
        hpAfter: target.hp
      }
    };
  });
}

function getTargetIds(context: EffectContext): string[] {
  if (context.targetIds && context.targetIds.length > 0) {
    return context.targetIds;
  }

  if (context.targetId) {
    return [context.targetId];
  }

  return [context.playerId];
}
