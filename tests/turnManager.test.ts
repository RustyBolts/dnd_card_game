import { describe, expect, it } from "vitest";
import { createStartedGame } from "./testUtils.js";

describe("turn manager", () => {
  it("ends the current turn, advances turn number, restores next player energy, and draws a card", () => {
    const store = createStartedGame();
    const state = store.getState();
    const nextPlayerId = "p2";
    const nextHandBefore = state.zones.hand[nextPlayerId].length;

    const events = store.endTurn("p1");

    expect(events.map((event) => event.type)).toEqual(["TURN_ENDED", "TURN_STARTED", "CARD_DRAWN"]);
    expect(state.turn).toBe(2);
    expect(state.currentPlayerId).toBe(nextPlayerId);
    expect(state.players[nextPlayerId].energy).toBe(1);
    expect(state.players[nextPlayerId].maxEnergy).toBe(1);
    expect(state.zones.hand[nextPlayerId].length).toBe(nextHandBefore + 1);
  });
});
