import type { CardDefinition, CardInstance, VisibleCardInstance } from "../shared/types/card.js";
import type { GameState, VisibleGameState } from "../shared/types/game.js";

export class SnapshotService {
  constructor(private readonly cardDefinitions: Record<string, CardDefinition>) {}

  createVisibleState(state: GameState, viewerId: string): VisibleGameState {
    const deck: VisibleGameState["zones"]["deck"] = {};
    const hand: VisibleGameState["zones"]["hand"] = {};
    const handCounts: VisibleGameState["zones"]["handCounts"] = {};
    const deckCounts: VisibleGameState["zones"]["deckCounts"] = {};
    const temporary: VisibleGameState["zones"]["temporary"] = {};
    const temporaryCounts: VisibleGameState["zones"]["temporaryCounts"] = {};
    const exhaust: VisibleGameState["zones"]["exhaust"] = {};
    const exhaustCounts: VisibleGameState["zones"]["exhaustCounts"] = {};
    const drawPreview: VisibleGameState["zones"]["drawPreview"] = {};

    for (const playerId of state.playerOrder) {
      deckCounts[playerId] = state.zones.deck[playerId]?.length ?? 0;
      handCounts[playerId] = state.zones.hand[playerId]?.length ?? 0;
      temporaryCounts[playerId] = state.zones.temporary[playerId]?.length ?? 0;
      exhaustCounts[playerId] = state.zones.exhaust[playerId]?.length ?? 0;
      deck[playerId] = playerId === viewerId
        ? this.sortCardsByName(state.zones.deck[playerId] ?? []).map((card) => this.toVisibleCard(card))
        : [];
      hand[playerId] = (state.zones.hand[playerId] ?? []).map((card) =>
        playerId === viewerId ? this.toVisibleCard(card) : this.toHiddenCard(card)
      );
      temporary[playerId] = (state.zones.temporary[playerId] ?? []).map((card) => this.toVisibleCard(card));
      exhaust[playerId] = (state.zones.exhaust[playerId] ?? []).map((card) => this.toVisibleCard(card));
      drawPreview[playerId] = playerId === viewerId
        ? this.getDrawPreview(state, playerId).map((card) => this.toVisibleCard(card))
        : [];
    }

    return {
      ...state,
      viewerId,
      players: clone(state.players),
      zones: {
        deck,
        deckCounts,
        hand,
        handCounts,
        temporary,
        temporaryCounts,
        exhaust,
        exhaustCounts,
        drawPreview,
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
      effect: definition?.effect,
      targeting: definition?.targeting,
      consumable: definition?.consumable
    };
  }

  private sortCardsByName(cards: CardInstance[]): CardInstance[] {
    return [...cards].sort((a, b) => {
      const aName = this.cardDefinitions[a.cardId]?.name ?? a.cardId;
      const bName = this.cardDefinitions[b.cardId]?.name ?? b.cardId;
      return aName.localeCompare(bName, "zh-Hant");
    });
  }

  private getDrawPreview(state: GameState, playerId: string): CardInstance[] {
    const previewCount = Math.max(0, state.players[playerId]?.character?.abilityModifiers.wisdom ?? 0);
    if (previewCount === 0) {
      return [];
    }

    return [...(state.zones.deck[playerId] ?? [])].slice(-previewCount).reverse();
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
