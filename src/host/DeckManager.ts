import type { CardInstance } from "../shared/types/card.js";
import { STARTER_DECK_CARD_IDS } from "../shared/rules/cardDefinitions.js";

export class DeckManager {
  private nextCardNumber = 1;

  constructor(private readonly starterDeckCardIds: readonly string[] = STARTER_DECK_CARD_IDS) {}

  buildStarterDeck(playerId: string): CardInstance[] {
    return this.starterDeckCardIds.map((cardId) => this.createCard(cardId, playerId, "DECK"));
  }

  createCard(cardId: string, ownerId: string, zone: CardInstance["zone"]): CardInstance {
    return {
      instanceId: `card_${this.nextCardNumber++}`,
      cardId,
      ownerId,
      zone
    };
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
