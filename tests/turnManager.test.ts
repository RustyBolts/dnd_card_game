import { describe, expect, it } from "vitest";
import type { CardInstance } from "../src/shared/types/card.js";
import type { CardCatalog } from "../src/shared/types/cardCatalog.js";
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
          statusRetainCount: 1,
          discardCount: 1
        }
      }
    ]);
    expect(state.turnPhase).toBe("DISCARD");
    expect(state.pendingDiscard).toEqual({
      playerId: "p1",
      retainCount: 1,
      statusRetainCount: 1
    });
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

  it("starts a discard phase for end-turn cleanup even when no cards can be retained", () => {
    const store = createStartedGame();
    const state = store.getState();
    const discardCard = createCard("discard_me", "fireball", "p1");
    state.players.p1.character!.abilityModifiers.intelligence = 0;
    state.zones.hand.p1 = [discardCard];

    const endEvents = store.endTurn("p1");

    expect(endEvents.map((event) => event.type)).toEqual(["DISCARD_PHASE_STARTED"]);
    expect(state.turnPhase).toBe("DISCARD");
    expect(state.pendingDiscard).toEqual({
      playerId: "p1",
      retainCount: 0,
      statusRetainCount: 0
    });
    expect(state.zones.hand.p1).toEqual([discardCard]);

    const discardEvents = store.discardCard("p1", discardCard.instanceId);

    expect(discardEvents.map((event) => event.type)).toContain("CARD_DISCARDED");
    expect(discardEvents.map((event) => event.type)).toContain("TURN_ENDED");
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

  it("uses status cards before non-status cards when applying intelligence retention", () => {
    const store = createStartedGame(createRetentionCatalog());
    const state = store.getState();
    const statusCard = createCard("status_1", "bleeding", "p1");
    const firstNormalCard = createCard("normal_1", "strike", "p1");
    const secondNormalCard = createCard("normal_2", "strike", "p1");
    state.players.p1.character!.abilityModifiers.intelligence = 2;
    state.players.p1.character!.abilityModifiers.constitution = 0;
    state.zones.hand.p1 = [statusCard, firstNormalCard, secondNormalCard];

    const endEvents = store.endTurn("p1");

    expect(endEvents[0]).toMatchObject({
      type: "DISCARD_PHASE_STARTED",
      payload: {
        retainCount: 2,
        statusRetainCount: 2,
        discardCount: 1
      }
    });
    expect(() => store.discardCard("p1", statusCard.instanceId)).toThrow(
      "Discard the required non-status cards"
    );

    const discardEvents = store.discardCard("p1", firstNormalCard.instanceId);

    expect(discardEvents.map((event) => event.type)).toContain("TURN_ENDED");
    expect(state.zones.hand.p1).toEqual([statusCard, secondNormalCard]);
  });

  it("uses a positive constitution modifier only for additional status cards", () => {
    const store = createStartedGame(createRetentionCatalog());
    const state = store.getState();
    state.players.p1.character!.abilityModifiers.intelligence = 2;
    state.players.p1.character!.abilityModifiers.constitution = 1;
    state.zones.hand.p1 = [
      createCard("status_1", "bleeding", "p1"),
      createCard("status_2", "bleeding", "p1"),
      createCard("status_3", "bleeding", "p1")
    ];

    const events = store.endTurn("p1");

    expect(events.map((event) => event.type)).not.toContain("DISCARD_PHASE_STARTED");
    expect(events.map((event) => event.type)).toContain("TURN_ENDED");
    expect(state.zones.hand.p1).toHaveLength(3);
  });

  it("does not use constitution retention for non-status cards", () => {
    const store = createStartedGame(createRetentionCatalog());
    const state = store.getState();
    state.players.p1.character!.abilityModifiers.intelligence = 2;
    state.players.p1.character!.abilityModifiers.constitution = 3;
    state.zones.hand.p1 = [
      createCard("normal_1", "strike", "p1"),
      createCard("normal_2", "strike", "p1"),
      createCard("normal_3", "strike", "p1")
    ];

    const events = store.endTurn("p1");

    expect(events[0]).toMatchObject({
      type: "DISCARD_PHASE_STARTED",
      payload: {
        retainCount: 2,
        statusRetainCount: 5,
        discardCount: 1
      }
    });
  });

  it("unlocks status discards after required non-status discards are complete", () => {
    const store = createStartedGame(createRetentionCatalog());
    const state = store.getState();
    const normalCard = createCard("normal_1", "strike", "p1");
    const statusCards = [1, 2, 3, 4].map((index) =>
      createCard(`status_${index}`, "bleeding", "p1")
    );
    state.players.p1.character!.abilityModifiers.intelligence = 2;
    state.players.p1.character!.abilityModifiers.constitution = 1;
    state.zones.hand.p1 = [normalCard, ...statusCards];

    const endEvents = store.endTurn("p1");

    expect(endEvents[0]).toMatchObject({
      type: "DISCARD_PHASE_STARTED",
      payload: {
        retainCount: 2,
        statusRetainCount: 3,
        discardCount: 2
      }
    });
    expect(() => store.discardCard("p1", statusCards[0].instanceId)).toThrow(
      "Discard the required non-status cards"
    );

    const normalDiscardEvents = store.discardCard("p1", normalCard.instanceId);
    expect(normalDiscardEvents.map((event) => event.type)).not.toContain("TURN_ENDED");

    const statusDiscardEvents = store.discardCard("p1", statusCards[0].instanceId);
    expect(statusDiscardEvents.map((event) => event.type)).toContain("HP_LOST");
    expect(statusDiscardEvents.map((event) => event.type)).toContain("TURN_ENDED");
    expect(state.zones.hand.p1).toEqual(statusCards.slice(1));
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

function createRetentionCatalog(): CardCatalog {
  return {
    version: "retention-test",
    cardDefinitions: {
      strike: {
        cardId: "strike",
        name: "Strike",
        cost: 1,
        type: "ATTACK",
        description: "No effect.",
        effect: { type: "NONE" },
        targeting: { selection: "NONE", scope: "SELF", requiresTarget: false }
      },
      bleeding: {
        cardId: "bleeding",
        name: "出血",
        cost: 9,
        type: "STATUS",
        description: "結算時失去 1 HP。",
        effect: { type: "LOSE_HP", value: 1 },
        targeting: { selection: "NONE", scope: "SELF", requiresTarget: false }
      }
    },
    starterDeckCardIds: ["strike", "strike", "strike", "strike", "strike", "strike"],
    transformRules: []
  };
}
