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
        cardInstanceId: event.payload.cardInstanceId
      }
    };
  }

  if (event.type === "CARD_TRANSFORMED") {
    if (event.payload.playerId === recipientPlayerId) {
      return event;
    }

    return null;
  }

  return event;
}
