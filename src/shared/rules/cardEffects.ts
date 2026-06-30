import type {
  CardDefinition,
  CardDrawPile,
  CardEffectDefinition,
  CardInstance
} from "../types/card.js";
import type {
  CardAddedToHandEvent,
  CardDrawnEvent,
  DeckRecycledEvent,
  DamageAppliedEvent,
  DamagePreventedEvent,
  EnergyLostEvent,
  GameEvent,
  GameEndedEvent,
  HealAppliedEvent,
  HpLostEvent
} from "../types/network.js";
import type { GameState } from "../types/game.js";

export type DrawCardsFn = (
  playerId: string,
  count: number,
  pile?: CardDrawPile
) => Array<CardDrawnEvent | DeckRecycledEvent>;

export type AddCardsToHandFn = (
  playerId: string,
  cardId: string,
  count: number
) => CardAddedToHandEvent[];

export type BeforeDamageHitResult = {
  prevented: boolean;
  events: GameEvent[];
};

export type BeforeDamageHitFn = (
  targetId: string,
  amount: number
) => BeforeDamageHitResult;

export type EffectContext = {
  state: GameState;
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  playerId: string;
  targetId?: string;
  targetIds?: string[];
  nextSeq: () => number;
  drawCards: DrawCardsFn;
  addCardsToHand: AddCardsToHandFn;
  beforeDamageHit?: BeforeDamageHitFn;
};

export type EffectEvent =
  | DamageAppliedEvent
  | DamagePreventedEvent
  | HealAppliedEvent
  | HpLostEvent
  | EnergyLostEvent
  | CardAddedToHandEvent
  | CardDrawnEvent
  | DeckRecycledEvent
  | GameEndedEvent;

export function resolveCardEffect(context: EffectContext): GameEvent[] {
  const effect = context.sourceDefinition.effect;

  if (effect.type === "DAMAGE") {
    return resolveDamage(effect, context);
  }

  if (effect.type === "HEAL") {
    return resolveHeal(effect, context);
  }

  if (effect.type === "LOSE_HP") {
    return resolveLoseHp(effect, context);
  }

  if (effect.type === "LOSE_ENERGY") {
    return resolveLoseEnergy(effect, context);
  }

  if (effect.type === "ADD_CARD_TO_HAND") {
    return resolveAddCardsToHand(effect, context);
  }

  if (effect.type === "DRAW_FROM_PILE") {
    return context.drawCards(context.playerId, effect.count, effect.pile);
  }

  if (effect.type === "NONE") {
    return [];
  }

  return context.drawCards(context.playerId, effect.count);
}

function resolveAddCardsToHand(
  effect: Extract<CardEffectDefinition, { type: "ADD_CARD_TO_HAND" }>,
  context: EffectContext
): CardAddedToHandEvent[] {
  const targetIds = getTargetIds(context);
  if (targetIds.length === 0) {
    throw new Error("No valid target for add-card-to-hand effect.");
  }

  return targetIds.flatMap((targetId) =>
    context.addCardsToHand(targetId, effect.cardId, effect.count)
  );
}

function resolveDamage(
  effect: Extract<CardEffectDefinition, { type: "DAMAGE" }>,
  context: EffectContext
): GameEvent[] {
  const targetIds = getTargetIds(context);
  if (targetIds.length === 0) {
    throw new Error("No valid target for damage effect.");
  }

  const events: GameEvent[] = [];
  const hitCount = effect.count ?? 1;

  for (const targetId of targetIds) {
    const target = context.state.players[targetId];
    if (!target) {
      throw new Error(`Target player ${targetId} does not exist.`);
    }

    for (let hitIndex = 0; hitIndex < hitCount; hitIndex += 1) {
      const interception = context.beforeDamageHit?.(targetId, effect.value);
      if (interception) {
        events.push(...interception.events);
        if (interception.prevented) {
          if (context.state.status === "ENDED") {
            return events;
          }
          continue;
        }
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
        const winnerId = resolveWinnerId(context, targetId);
        context.state.status = "ENDED";
        context.state.winnerId = winnerId;
        events.push({
          type: "GAME_ENDED",
          seq: context.nextSeq(),
          payload: {
            winnerId
          }
        });
        return events;
      }
    }
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

function resolveLoseHp(
  effect: Extract<CardEffectDefinition, { type: "LOSE_HP" }>,
  context: EffectContext
): Array<HpLostEvent | GameEndedEvent> {
  const targetIds = getTargetIds(context);
  if (targetIds.length === 0) {
    throw new Error("No valid target for HP loss effect.");
  }

  const events: Array<HpLostEvent | GameEndedEvent> = [];
  let defeatedTargetId: string | null = null;

  for (const targetId of targetIds) {
    const target = context.state.players[targetId];
    if (!target) {
      throw new Error(`Target player ${targetId} does not exist.`);
    }

    target.hp = Math.max(0, target.hp - effect.value);
    events.push({
      type: "HP_LOST",
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
    const winnerId = resolveWinnerId(context, defeatedTargetId);
    context.state.status = "ENDED";
    context.state.winnerId = winnerId;
    events.push({
      type: "GAME_ENDED",
      seq: context.nextSeq(),
      payload: {
        winnerId
      }
    });
  }

  return events;
}

function resolveLoseEnergy(
  effect: Extract<CardEffectDefinition, { type: "LOSE_ENERGY" }>,
  context: EffectContext
): EnergyLostEvent[] {
  const targetIds = getTargetIds(context);
  if (targetIds.length === 0) {
    throw new Error("No valid target for energy loss effect.");
  }

  const events: EnergyLostEvent[] = [];

  for (const targetId of targetIds) {
    const target = context.state.players[targetId];
    if (!target) {
      throw new Error(`Target player ${targetId} does not exist.`);
    }

    const amount = Math.min(effect.value, target.energy);
    if (amount <= 0) {
      continue;
    }

    target.energy -= amount;
    events.push({
      type: "ENERGY_LOST",
      seq: context.nextSeq(),
      payload: {
        sourceId: context.sourceCard.instanceId,
        targetId,
        amount,
        energyAfter: target.energy
      }
    });
  }

  return events;
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

function resolveWinnerId(context: EffectContext, defeatedTargetId: string): string {
  if (defeatedTargetId !== context.playerId) {
    return context.playerId;
  }

  const defeatedPlayer = context.state.players[defeatedTargetId];
  const opposingPlayerId = context.state.playerOrder.find((candidateId) => {
    if (candidateId === defeatedTargetId) {
      return false;
    }

    const candidate = context.state.players[candidateId];
    if (!candidate || candidate.hp <= 0) {
      return false;
    }

    if (defeatedPlayer?.teamId || candidate.teamId) {
      return defeatedPlayer?.teamId !== candidate.teamId;
    }

    return true;
  });

  return opposingPlayerId ?? context.playerId;
}
