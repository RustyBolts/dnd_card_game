import { describe, expect, it } from "vitest";
import type { CardInstance } from "../src/shared/types/card.js";
import { createStartedGame } from "./testUtils.js";

describe("turn manager", () => {
  it("ends the current turn immediately when no discard choice is required", () => {
    const store = createStartedGame();
    const state = store.getState();
    const nextPlayerId = "p2";
    const nextHandBefore = state.zones.hand[nextPlayerId].length;
    state.zones.hand.p1 = [];

    const events = store.endTurn("p1");

    expect(events.map((event) => event.type)).toEqual([
      "TURN_ENDED",
      "TURN_STARTED",
      "CARD_DRAWN",
      "CARD_DRAWN",
      "CARD_DRAWN",
      "CARD_DRAWN"
    ]);
    expect(state.turn).toBe(2);
    expect(state.currentPlayerId).toBe(nextPlayerId);
    expect(state.players[nextPlayerId].energy).toBe(3);
    expect(state.players[nextPlayerId].maxEnergy).toBe(3);
    expect(state.zones.hand[nextPlayerId].length).toBe(nextHandBefore + 4);
  });

  it("starts a discard phase when intelligence can retain fewer cards than the hand contains", () => {
    const store = createStartedGame();
    const state = store.getState();
    const discardCard = createCard("discard_me", "fireball", "p1");
    const retainedCard = createCard("retain_me", "dagger_strike", "p1");
    state.zones.hand.p1 = [discardCard, retainedCard];

    const endEvents = store.endTurn("p1");

    expect(endEvents).toEqual([
      {
        type: "DISCARD_PHASE_STARTED",
        seq: expect.any(Number),
        payload: {
          playerId: "p1",
          retainCount: 1,
          discardCount: 1
        }
      }
    ]);
    expect(state.turnPhase).toBe("DISCARD");
    expect(state.pendingDiscard).toEqual({ playerId: "p1", retainCount: 1 });
    expect(state.currentPlayerId).toBe("p1");

    const discardEvents = store.discardCard("p1", discardCard.instanceId);

    expect(discardEvents.map((event) => event.type)).toEqual([
      "CARD_DISCARDED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARD_DRAWN",
      "CARD_DRAWN",
      "CARD_DRAWN",
      "CARD_DRAWN"
    ]);
    expect(state.turnPhase).toBe("MAIN");
    expect(state.pendingDiscard).toBeNull();
    expect(state.currentPlayerId).toBe("p2");
    expect(state.zones.hand.p1).toEqual([retainedCard]);
    expect(state.zones.temporary.p1).toContain(discardCard);
  });

  it("retains leftover energy up to the positive strength modifier on the player's next turn", () => {
    const store = createStartedGame();
    const state = store.getState();
    state.players.p1.energy = 2;
    state.zones.hand.p1 = [];
    state.zones.hand.p2 = [];

    store.endTurn("p1");
    state.zones.hand.p2 = [];
    const events = store.endTurn("p2");

    expect(events.map((event) => event.type)).toContain("TURN_STARTED");
    expect(state.currentPlayerId).toBe("p1");
    expect(state.players.p1.maxEnergy).toBe(3);
    expect(state.players.p1.energy).toBe(5);
  });

  it("recycles only the temporary pile into the deck when drawing from an empty deck", () => {
    const store = createStartedGame();
    const state = store.getState();
    const temporaryCards = [
      createCard("temp_1", "fireball", "p1", "TEMPORARY"),
      createCard("temp_2", "dagger_strike", "p1", "TEMPORARY")
    ];
    const exhaustedCard = createCard("exhaust_1", "healing_potion", "p1", "EXHAUST");
    state.zones.deck.p1 = [];
    state.zones.temporary.p1 = [...temporaryCards];
    state.zones.exhaust.p1 = [exhaustedCard];

    const events = store.drawCard("p1");

    expect(events.map((event) => event.type)).toEqual(["DECK_RECYCLED", "CARD_DRAWN"]);
    expect(state.zones.temporary.p1).toHaveLength(0);
    expect(state.zones.deck.p1).toHaveLength(1);
    expect(state.zones.hand.p1.some((card) => temporaryCards.includes(card))).toBe(true);
    expect(state.zones.exhaust.p1).toEqual([exhaustedCard]);
  });
});

function createCard(
  instanceId: string,
  cardId: string,
  ownerId: string,
  zone: CardInstance["zone"] = "HAND"
): CardInstance {
  return {
    instanceId,
    cardId,
    ownerId,
    zone
  };
}
