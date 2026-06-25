import type { CardType } from "../types/card.js";

export function canUseCardForConsumeCost(card: { type?: CardType }): boolean {
  return card.type !== undefined && card.type !== "STATUS";
}
