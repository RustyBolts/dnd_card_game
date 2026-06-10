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
});
