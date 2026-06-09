import { describe, expect, it } from "vitest";
import type { CardInstance } from "../src/shared/types/card.js";
import type { CardCatalog } from "../src/shared/types/cardCatalog.js";
import { createStartedGame } from "./testUtils.js";

describe("card effects", () => {
  it("plays a damage card from hand, pays energy, moves the card to graveyard, and damages the target", () => {
    const store = createStartedGame();
    const state = store.getState();
    const playerId = "p1";
    const targetId = "p2";
    const card: CardInstance = {
      instanceId: "test_fireball",
      cardId: "fireball",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].energy = 2;
    state.zones.hand[playerId].push(card);

    const events = store.playCard(playerId, card.instanceId, targetId);

    expect(events.map((event) => event.type)).toContain("CARD_PLAYED");
    expect(events.map((event) => event.type)).toContain("DAMAGE_APPLIED");
    expect(state.players[playerId].energy).toBe(0);
    expect(state.players[targetId].hp).toBe(17);
    expect(state.zones.hand[playerId]).not.toContain(card);
    expect(state.zones.graveyard).toContain(card);
  });

  it("rejects enemy single-target damage cards without an explicit target", () => {
    const store = createStartedGame();
    const state = store.getState();
    const playerId = "p1";
    const card: CardInstance = {
      instanceId: "test_fireball",
      cardId: "fireball",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].energy = 2;
    state.zones.hand[playerId].push(card);

    expect(() => store.playCard(playerId, card.instanceId)).toThrow("requires a target");
  });

  it("rejects enemy single-target damage cards targeting self", () => {
    const store = createStartedGame();
    const state = store.getState();
    const playerId = "p1";
    const card: CardInstance = {
      instanceId: "test_fireball",
      cardId: "fireball",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].energy = 2;
    state.zones.hand[playerId].push(card);

    expect(() => store.playCard(playerId, card.instanceId, playerId)).toThrow("cannot target p1");
  });

  it("allows a card to explicitly target self when its targeting scope permits any player", () => {
    const selfTargetCatalog: CardCatalog = {
      version: "self-target-test",
      cardDefinitions: {
        focus: {
          cardId: "focus",
          name: "Focus",
          cost: 0,
          type: "SKILL",
          description: "Restore 1 HP to any player.",
          effect: { type: "HEAL", value: 1 },
          targeting: { selection: "SINGLE", scope: "ANY", requiresTarget: true }
        }
      },
      starterDeckCardIds: ["focus"]
    };
    const store = createStartedGame(selfTargetCatalog);
    const state = store.getState();
    const playerId = "p1";
    const card: CardInstance = {
      instanceId: "test_focus",
      cardId: "focus",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].hp = 10;
    state.zones.hand[playerId].push(card);

    const events = store.playCard(playerId, card.instanceId, playerId);

    expect(events.map((event) => event.type)).toContain("HEAL_APPLIED");
    expect(state.players[playerId].hp).toBe(11);
  });

  it("draw effect adds cards to the acting player's hand", () => {
    const store = createStartedGame();
    const state = store.getState();
    const playerId = "p1";
    const card: CardInstance = {
      instanceId: "test_draw",
      cardId: "tactical_insight",
      ownerId: playerId,
      zone: "HAND"
    };
    const handBefore = state.zones.hand[playerId].length;

    state.players[playerId].energy = 1;
    state.zones.hand[playerId].push(card);

    const events = store.playCard(playerId, card.instanceId);

    expect(events.filter((event) => event.type === "CARD_DRAWN")).toHaveLength(2);
    expect(state.zones.hand[playerId].length).toBe(handBefore + 2);
  });
});
