import type WebSocket from "ws";
import type { GameCommand } from "../shared/types/network.js";

export class CommandSender {
  constructor(private readonly getSocket: () => WebSocket | null) {}

  join(playerName: string): void {
    this.send({
      type: "JOIN_ROOM",
      requestId: createRequestId(),
      payload: {
        playerName
      }
    });
  }

  ready(): void {
    this.send({
      type: "PLAYER_READY",
      requestId: createRequestId()
    });
  }

  draw(): void {
    this.send({
      type: "DRAW_CARD",
      requestId: createRequestId()
    });
  }

  play(cardInstanceId: string, targetId?: string): void {
    this.send({
      type: "PLAY_CARD",
      requestId: createRequestId(),
      payload: {
        cardInstanceId,
        targetId
      }
    });
  }

  discard(cardInstanceId: string): void {
    this.send({
      type: "DISCARD_CARD",
      requestId: createRequestId(),
      payload: {
        cardInstanceId
      }
    });
  }

  endTurn(): void {
    this.send({
      type: "END_TURN",
      requestId: createRequestId()
    });
  }

  private send(command: GameCommand): void {
    const socket = this.getSocket();
    if (!socket || socket.readyState !== socket.OPEN) {
      throw new Error("WebSocket is not open.");
    }

    socket.send(JSON.stringify(command));
  }
}

function createRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
