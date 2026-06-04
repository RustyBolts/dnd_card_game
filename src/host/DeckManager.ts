import type { CardInstance } from "../shared/types/card.js";
import { STARTER_DECK_CARD_IDS } from "../shared/rules/cardDefinitions.js";

export class DeckManager {
  private nextCardNumber = 1;

  buildStarterDeck(playerId: string): CardInstance[] {
    return STARTER_DECK_CARD_IDS.map((cardId) => ({
      instanceId: `card_${this.nextCardNumber++}`,
      cardId,
      ownerId: playerId,
      zone: "DECK"
    }));
  }

  shuffle(deck: CardInstance[]): CardInstance[] {
    const copy = [...deck];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    }
    return copy;
  }
}
