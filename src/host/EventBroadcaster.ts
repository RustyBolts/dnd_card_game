import type WebSocket from "ws";
import { redactPrivateEvent } from "../shared/rules/eventPrivacy.js";
import type { GameEvent } from "../shared/types/network.js";
import { GameStateStore } from "./GameStateStore.js";

type ConnectionRegistry = () => Iterable<[WebSocket, string]>;

export class EventBroadcaster {
  constructor(
    private readonly store: GameStateStore,
    private readonly getConnections: ConnectionRegistry
  ) {}

  send(socket: WebSocket, event: GameEvent): void {
    if (socket.readyState !== socket.OPEN) {
      return;
    }

    socket.send(JSON.stringify(event));
  }

  broadcast(events: GameEvent[]): void {
    for (const event of events) {
      for (const [socket, playerId] of this.getConnections()) {
        const visibleEvent = redactPrivateEvent(event, playerId);
        if (visibleEvent) {
          this.send(socket, visibleEvent);
        }
      }
    }
  }

  broadcastSnapshots(): void {
    for (const [socket, playerId] of this.getConnections()) {
      this.send(socket, this.store.createSnapshotEvent(playerId));
    }
  }

  sendSnapshot(socket: WebSocket, playerId: string): void {
    this.send(socket, this.store.createSnapshotEvent(playerId));
  }
}
