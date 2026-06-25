import { describe, expect, it } from "vitest";
import { canUseCardForConsumeCost } from "../src/shared/rules/cardResources.js";

describe("card resource eligibility", () => {
  it("allows non-status cards as consumeCardCount resources", () => {
    expect(canUseCardForConsumeCost({ type: "ATTACK" })).toBe(true);
    expect(canUseCardForConsumeCost({ type: "SKILL" })).toBe(true);
  });

  it("rejects status and unknown cards as consumeCardCount resources", () => {
    expect(canUseCardForConsumeCost({ type: "STATUS" })).toBe(false);
    expect(canUseCardForConsumeCost({})).toBe(false);
  });
});
