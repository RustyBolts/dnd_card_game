import { GameStateStore } from "../src/host/GameStateStore.js";

export function createStartedGame(): GameStateStore {
  const store = new GameStateStore("test_room");
  const playerOne = store.addPlayer("Alice").player;
  const playerTwo = store.addPlayer("Bob").player;

  store.markPlayerReady(playerOne.playerId);
  store.markPlayerReady(playerTwo.playerId);

  return store;
}
