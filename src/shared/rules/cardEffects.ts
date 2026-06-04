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

  return context.drawCards(context.playerId, effect.count);
}

function resolveDamage(
  effect: Extract<CardEffectDefinition, { type: "DAMAGE" }>,
  context: EffectContext
): EffectEvent[] {
  const targetId = context.targetId ?? findFirstOpponent(context.state, context.playerId);
  if (!targetId) {
    throw new Error("No valid target for damage effect.");
  }

  const target = context.state.players[targetId];
  if (!target) {
    throw new Error(`Target player ${targetId} does not exist.`);
  }

  target.hp = Math.max(0, target.hp - effect.value);

  const events: EffectEvent[] = [
    {
      type: "DAMAGE_APPLIED",
      seq: context.nextSeq(),
      payload: {
        sourceId: context.sourceCard.instanceId,
        targetId,
        amount: effect.value,
        hpAfter: target.hp
      }
    }
  ];

  if (target.hp <= 0) {
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
  const targetId = context.targetId ?? context.playerId;
  const target = context.state.players[targetId];
  if (!target) {
    throw new Error(`Target player ${targetId} does not exist.`);
  }

  target.hp = Math.min(20, target.hp + effect.value);

  return [
    {
      type: "HEAL_APPLIED",
      seq: context.nextSeq(),
      payload: {
        sourceId: context.sourceCard.instanceId,
        targetId,
        amount: effect.value,
        hpAfter: target.hp
      }
    }
  ];
}

function findFirstOpponent(state: GameState, playerId: string): string | undefined {
  return state.playerOrder.find((candidateId) => candidateId !== playerId);
}
