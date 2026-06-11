import { GameStateStore } from "../src/host/GameStateStore.js";
import { createDefaultCharacterConfig } from "../src/shared/rules/characterRules.js";
import type { CardCatalog } from "../src/shared/types/cardCatalog.js";

export function createStartedGame(cardCatalog?: CardCatalog): GameStateStore {
  return createStartedGameWithPlayers(["Alice", "Bob"], cardCatalog);
}

export function createStartedGameWithPlayers(
  playerNames: string[],
  cardCatalog?: CardCatalog
): GameStateStore {
  const store = new GameStateStore("test_room", cardCatalog);
  const players = playerNames.map((name) => store.addPlayer(name, createDefaultCharacterConfig()).player);

  for (const player of players) {
    store.markPlayerReady(player.playerId);
  }

  return store;
}
