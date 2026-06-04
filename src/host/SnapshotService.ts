import type { CardDefinition, CardInstance, VisibleCardInstance } from "../shared/types/card.js";
import type { GameState, VisibleGameState } from "../shared/types/game.js";

export class SnapshotService {
  constructor(private readonly cardDefinitions: Record<string, CardDefinition>) {}

  createVisibleState(state: GameState, viewerId: string): VisibleGameState {
    const hand: VisibleGameState["zones"]["hand"] = {};
    const handCounts: VisibleGameState["zones"]["handCounts"] = {};
    const deckCounts: VisibleGameState["zones"]["deckCounts"] = {};

    for (const playerId of state.playerOrder) {
      deckCounts[playerId] = state.zones.deck[playerId]?.length ?? 0;
      handCounts[playerId] = state.zones.hand[playerId]?.length ?? 0;
      hand[playerId] = (state.zones.hand[playerId] ?? []).map((card) =>
        playerId === viewerId ? this.toVisibleCard(card) : this.toHiddenCard(card)
      );
    }

    return {
      ...state,
      viewerId,
      players: clone(state.players),
      zones: {
        deckCounts,
        hand,
        handCounts,
        board: state.zones.board.map((card) => this.toVisibleCard(card)),
        graveyard: state.zones.graveyard.map((card) => this.toVisibleCard(card)),
        exile: state.zones.exile.map((card) => this.toVisibleCard(card))
      }
    };
  }

  private toVisibleCard(card: CardInstance): VisibleCardInstance {
    const definition = this.cardDefinitions[card.cardId];
    return {
      ...card,
      name: definition?.name,
      cost: definition?.cost,
      type: definition?.type,
      description: definition?.description,
      effect: definition?.effect
    };
  }

  private toHiddenCard(card: CardInstance): VisibleCardInstance {
    return {
      instanceId: card.instanceId,
      cardId: "hidden",
      ownerId: card.ownerId,
      zone: card.zone,
      hidden: true
    };
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
