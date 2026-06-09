import { GameStateStore } from "../src/host/GameStateStore.js";
import type { CardCatalog } from "../src/shared/types/cardCatalog.js";

export function createStartedGame(cardCatalog?: CardCatalog): GameStateStore {
  const store = new GameStateStore("test_room", cardCatalog);
  const playerOne = store.addPlayer("Alice").player;
  const playerTwo = store.addPlayer("Bob").player;

  store.markPlayerReady(playerOne.playerId);
  store.markPlayerReady(playerTwo.playerId);

  return store;
}
