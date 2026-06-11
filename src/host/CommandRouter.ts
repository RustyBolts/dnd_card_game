import type { GameCommand, GameEvent } from "../shared/types/network.js";
import { CommandError } from "./CommandError.js";
import { GameStateStore } from "./GameStateStore.js";

export class CommandRouter {
  constructor(private readonly store: GameStateStore) {}

  handleJoin(command: Extract<GameCommand, { type: "JOIN_ROOM" }>) {
    return this.store.addPlayer(command.payload.playerName, command.payload.character);
  }

  handlePlayerCommand(playerId: string, command: Exclude<GameCommand, { type: "JOIN_ROOM" }>): GameEvent[] {
    switch (command.type) {
      case "PLAYER_READY":
        return this.store.markPlayerReady(playerId);
      case "DRAW_CARD":
        return this.store.drawCard(playerId);
      case "PLAY_CARD":
        return this.store.playCard(playerId, command.payload.cardInstanceId, command.payload.targetId);
      case "DISCARD_CARD":
        return this.store.discardCard(playerId, command.payload.cardInstanceId);
      case "END_TURN":
        return this.store.endTurn(playerId);
      default:
        throw new CommandError("UNKNOWN_COMMAND", "Unsupported player command.");
    }
  }
}
