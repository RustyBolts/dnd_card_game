import { describe, expect, it } from "vitest";
import type { CardInstance } from "../src/shared/types/card.js";
import { CommandError } from "../src/host/CommandError.js";
import { createStartedGame } from "./testUtils.js";

describe("host command validation", () => {
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
