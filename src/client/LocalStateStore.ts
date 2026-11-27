import type { CardDefinition } from "../shared/types/card.js";
import type { RaceDefinition } from "../shared/types/character.js";
import type { VisibleGameState } from "../shared/types/game.js";
import type { LoadoutCardDefinition, LoadoutSourceDefinition } from "../shared/types/loadout.js";
import type { GameEvent } from "../shared/types/network.js";

export class LocalStateStore {
  playerId: string | null = null;
  roomId: string | null = null;
  state: VisibleGameState | null = null;
  cardDefinitions: Record<string, CardDefinition> = {};
  races: Record<string, RaceDefinition> = {};
  loadoutSources: Record<string, LoadoutSourceDefinition> = {};
  loadoutCards: LoadoutCardDefinition[] = [];
  cardCatalogVersion: string | null = null;
  readonly eventLog: GameEvent[] = [];

  apply(event: GameEvent): void {
    this.eventLog.push(event);

    if (event.type === "JOIN_ACCEPTED") {
      this.playerId = event.payload.playerId;
      this.roomId = event.payload.roomId;
      return;
    }

    if (event.type === "GAME_STATE_SYNC") {
      this.state = event.payload.state;
      this.cardDefinitions = event.payload.cardDefinitions;
      this.races = event.payload.races;
      this.loadoutSources = event.payload.loadoutSources;
      this.loadoutCards = event.payload.loadoutCards;
      this.cardCatalogVersion = event.payload.cardCatalogVersion;
    }
  }
}
