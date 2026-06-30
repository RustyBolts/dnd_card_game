import type { GameEvent } from "../types/network.js";

export function redactPrivateEvent(event: GameEvent, recipientPlayerId: string): GameEvent | null {
  if (event.type === "CARD_DRAWN") {
    if (event.payload.playerId === recipientPlayerId) {
      return event;
    }

    return {
      ...event,
      payload: {
        playerId: event.payload.playerId,
        cardInstanceId: event.payload.cardInstanceId,
        ...(event.payload.sourcePile ? { sourcePile: event.payload.sourcePile } : {})
      }
    };
  }

  if (event.type === "CARD_ADDED_TO_HAND") {
    if (event.payload.playerId === recipientPlayerId) {
      return event;
    }

    return {
      ...event,
      payload: {
        playerId: event.payload.playerId,
        cardInstanceId: event.payload.cardInstanceId
      }
    };
  }

  if (
    event.type === "CARD_ACTION_TRIGGERED" &&
    event.payload.actionTag === "END_TURN_STATUS"
  ) {
    return event.payload.playerId === recipientPlayerId ? event : null;
  }

  if (event.type === "CARD_TRANSFORMED") {
    if (event.payload.playerId === recipientPlayerId) {
      return event;
    }

    return null;
  }

  if (event.type === "DISCARD_PHASE_STARTED") {
    return event.payload.playerId === recipientPlayerId ? event : null;
  }

  return event;
}
