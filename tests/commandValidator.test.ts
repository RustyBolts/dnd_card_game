import { describe, expect, it } from "vitest";
import type { CardInstance } from "../src/shared/types/card.js";
import { CommandError } from "../src/host/CommandError.js";
import { createStartedGame } from "./testUtils.js";
import { createDefaultCharacterConfig } from "../src/shared/rules/characterRules.js";
import { GameStateStore } from "../src/host/GameStateStore.js";

describe("host command validation", () => {
  it("creates a character with race-based HP and cached ability modifiers", () => {
    const store = new GameStateStore("test_room");
    const player = store.addPlayer("Gor", {
      raceId: "orc",
      abilityScores: {
        strength: 14,
        dexterity: 12,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
        constitution: 16
      }
    }).player;

    expect(player.character.abilityModifiers.constitution).toBe(3);
    expect(player.maxHp).toBe(28);
    expect(player.hp).toBe(28);
    expect(player.character.naturalArmorType).toBe("FUR");
  });

  it("rejects characters that do not spend exactly 24 ability points", () => {
    const store = new GameStateStore("test_room");

    expect(() => store.addPlayer("Alice", {
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

    expect(() => store.addPlayer("Alice", {
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

    expect(store.addPlayer("Alice", createDefaultCharacterConfig()).player.character.raceId).toBe("human");
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

  it("hides opponent hand details in player snapshots", () => {
    const store = createStartedGame();
    const snapshot = store.createSnapshotEvent("p1").payload.state;
    const opponentHand = snapshot.zones.hand.p2;

    expect(opponentHand.length).toBeGreaterThan(0);
    expect(opponentHand.every((card) => card.hidden)).toBe(true);
    expect(opponentHand.every((card) => card.cardId === "hidden")).toBe(true);
    expect(snapshot.zones.hand.p1.some((card) => !card.hidden && card.cardId !== "hidden")).toBe(true);
  });
});
