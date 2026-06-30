import { describe, expect, it } from "vitest";
import type { CardInstance } from "../src/shared/types/card.js";
import { CommandError } from "../src/host/CommandError.js";
import { createStartedGame } from "./testUtils.js";
import { createDefaultCharacterConfig } from "../src/shared/rules/characterRules.js";
import { GameStateStore } from "../src/host/GameStateStore.js";
import { CommandValidator } from "../src/host/CommandValidator.js";

describe("host command validation", () => {
  it("creates a character with race-based HP and cached ability modifiers", () => {
    const store = new GameStateStore("test_room");
    const player = store.addPlayer("Gor", "session_gor").player;
    store.setPlayerCharacter(player.playerId, {
      raceId: "orc",
      abilityScores: {
        strength: 14,
        dexterity: 12,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
        constitution: 16
      }
    });

    expect(player.character?.abilityModifiers.constitution).toBe(3);
    expect(player.maxHp).toBe(28);
    expect(player.hp).toBe(28);
    expect(player.character?.naturalArmorType).toBe("FUR");
  });

  it("rejects characters that do not spend exactly 24 ability points", () => {
    const store = new GameStateStore("test_room");

    const player = store.addPlayer("Alice", "session_alice").player;

    expect(() => store.setPlayerCharacter(player.playerId, {
      raceId: "human",
      abilityScores: {
        strength: 8,
        dexterity: 8,
        intelligence: 8,
        wisdom: 8,
        charisma: 8,
        constitution: 8
      }
    })).toThrow(/24 ability points/);
  });

  it("rejects character scores above the selected race creation max", () => {
    const store = new GameStateStore("test_room");

    const player = store.addPlayer("Alice", "session_alice").player;

    expect(() => store.setPlayerCharacter(player.playerId, {
      raceId: "orc",
      abilityScores: {
        strength: 13,
        dexterity: 12,
        intelligence: 16,
        wisdom: 11,
        charisma: 10,
        constitution: 10
      }
    })).toThrow(/intelligence exceeds/);
  });

  it("accepts the default human character used by local clients", () => {
    const store = new GameStateStore("test_room");
    const player = store.addPlayer("Alice", "session_alice").player;
    store.setPlayerCharacter(player.playerId, createDefaultCharacterConfig());

    expect(player.character?.raceId).toBe("human");
  });

  it("reuses the existing player for the same client session", () => {
    const store = new GameStateStore("test_room");
    const firstJoin = store.addPlayer("Alice", "session_alice").player;
    const secondJoin = store.addPlayer("Alice Again", "session_alice").player;

    expect(secondJoin.playerId).toBe(firstJoin.playerId);
    expect(store.getState().playerOrder).toEqual([firstJoin.playerId]);
    expect(secondJoin.name).toBe("Alice Again");
  });

  it("allows the same client session to reconnect after the game starts", () => {
    const store = createStartedGame();
    const reconnected = store.addPlayer("Alice Reconnected", "session_1").player;

    expect(reconnected.playerId).toBe("p1");
    expect(store.getState().playerOrder).toEqual(["p1", "p2"]);
    expect(reconnected.connected).toBe(true);
  });

  it("rejects non-current players trying to play a card", () => {
    const store = createStartedGame();
    const state = store.getState();
    const playerId = "p2";
    const card: CardInstance = {
      instanceId: "test_dagger",
      cardId: "dagger_strike",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].energy = 1;
    state.zones.hand[playerId].push(card);

    expect(() => store.playCard(playerId, card.instanceId, "p1")).toThrow(CommandError);
    expect(() => store.playCard(playerId, card.instanceId, "p1")).toThrow("Only the current player");
  });

  it("accepts consumed card resource ids on play card commands", () => {
    const validator = new CommandValidator();
    const command = validator.parse({
      type: "PLAY_CARD",
      requestId: "req_resource",
      payload: {
        cardInstanceId: "card_source",
        targetId: "p2",
        resourceCardInstanceIds: ["card_a", "card_b"],
        resourceTargets: {
          card_a: "p2"
        }
      }
    });

    expect(command).toEqual({
      type: "PLAY_CARD",
      requestId: "req_resource",
      payload: {
        cardInstanceId: "card_source",
        targetId: "p2",
        resourceCardInstanceIds: ["card_a", "card_b"],
        resourceTargets: {
          card_a: "p2"
        }
      }
    });
  });

  it("hides opponent hand details in player snapshots", () => {
    const store = createStartedGame();
    const state = store.getState();
    state.zones.nature.p1 = [{
      instanceId: "test_hidden_nature",
      cardId: "fireball",
      ownerId: "p1",
      zone: "NATURE"
    }];
    const snapshot = store.createSnapshotEvent("p1").payload.state;
    const opponentHand = snapshot.zones.hand.p2;

    expect(opponentHand.length).toBeGreaterThan(0);
    expect(opponentHand.every((card) => card.hidden)).toBe(true);
    expect(opponentHand.every((card) => card.cardId === "hidden")).toBe(true);
    expect(snapshot.zones.hand.p1.some((card) => !card.hidden && card.cardId !== "hidden")).toBe(true);
    expect(snapshot.zones.deck.p2).toEqual([]);
    expect(snapshot.zones.deck.p1).toHaveLength(snapshot.zones.deckCounts.p1);
    expect(snapshot.zones.natureCounts.p1).toBe(1);
    expect(snapshot.zones.nature.p1).toEqual([]);
    expect(snapshot.zones.drawPreview.p1).toHaveLength(1);
    expect(snapshot.zones.drawPreview.p1.some((card) => card.instanceId === "test_hidden_nature")).toBe(false);
    expect(snapshot.zones.drawPreview.p2).toEqual([]);
  });
});
