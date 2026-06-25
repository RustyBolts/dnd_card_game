import { describe, expect, it } from "vitest";
import { redactPrivateEvent } from "../src/shared/rules/eventPrivacy.js";
import type { GameEvent } from "../src/shared/types/network.js";

describe("event privacy", () => {
  it("redacts transformed hand-card identities from other players", () => {
    const event: GameEvent = {
      type: "CARD_TRANSFORMED",
      seq: 7,
      payload: {
        playerId: "p1",
        ruleId: "T001",
        sourceId: "test_catalyst",
        cardInstanceId: "test_wolf_form",
        privateCardData: {
          previousCardId: "wolf_form",
          cardId: "bear_form"
        }
      }
    };

    expect(redactPrivateEvent(event, "p1")).toBe(event);
    expect(redactPrivateEvent(event, "p2")).toBeNull();
  });

  it("hides hand-composition-dependent discard counts from other players", () => {
    const event: GameEvent = {
      type: "DISCARD_PHASE_STARTED",
      seq: 8,
      payload: {
        playerId: "p1",
        retainCount: 2,
        statusRetainCount: 3,
        discardCount: 2
      }
    };

    expect(redactPrivateEvent(event, "p1")).toBe(event);
    expect(redactPrivateEvent(event, "p2")).toBeNull();
  });

  it("redacts card identities added directly to another player's hand", () => {
    const event: GameEvent = {
      type: "CARD_ADDED_TO_HAND",
      seq: 9,
      payload: {
        playerId: "p2",
        sourceId: "test_sneak_attack",
        cardInstanceId: "card_42",
        privateCardData: {
          cardId: "bleeding"
        }
      }
    };

    expect(redactPrivateEvent(event, "p2")).toBe(event);
    expect(redactPrivateEvent(event, "p1")).toEqual({
      type: "CARD_ADDED_TO_HAND",
      seq: 9,
      payload: {
        playerId: "p2",
        cardInstanceId: "card_42"
      }
    });
  });

  it("hides end-turn status source cards that remain in a private hand", () => {
    const event: GameEvent = {
      type: "CARD_ACTION_TRIGGERED",
      seq: 10,
      payload: {
        playerId: "p1",
        cardInstanceId: "test_ignited",
        cardId: "ignited",
        actionTag: "END_TURN_STATUS",
        trigger: "TURN_ENDED",
        destinationZone: "HAND",
        targetId: "p1",
        targetIds: ["p1"]
      }
    };

    expect(redactPrivateEvent(event, "p1")).toBe(event);
    expect(redactPrivateEvent(event, "p2")).toBeNull();
  });
});
