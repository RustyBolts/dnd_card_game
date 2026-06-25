import { describe, expect, it } from "vitest";
import {
  calculateHandDiscardRequirements,
  calculateStatusRetainCount
} from "../src/shared/rules/handRetention.js";

describe("hand retention", () => {
  it("lets status cards consume the intelligence retention count first", () => {
    expect(calculateHandDiscardRequirements({
      retainCount: 2,
      statusRetainCount: 2,
      statusCardCount: 1,
      nonStatusCardCount: 2
    })).toEqual({
      nonStatusRetainCount: 1,
      nonStatusDiscardCount: 1,
      statusDiscardCount: 0,
      discardCount: 1,
      phase: "NON_STATUS"
    });
  });

  it("requires excess status cards only after non-status cards", () => {
    expect(calculateHandDiscardRequirements({
      retainCount: 2,
      statusRetainCount: 3,
      statusCardCount: 4,
      nonStatusCardCount: 1
    })).toEqual({
      nonStatusRetainCount: 0,
      nonStatusDiscardCount: 1,
      statusDiscardCount: 1,
      discardCount: 2,
      phase: "NON_STATUS"
    });
  });

  it("ignores a negative constitution modifier for status retention", () => {
    expect(calculateStatusRetainCount(2, -1)).toBe(2);
    expect(calculateStatusRetainCount(2, 3)).toBe(5);
  });
});
