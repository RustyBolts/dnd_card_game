import WebSocket, { WebSocketServer } from "ws";
import type { GameCommand } from "../shared/types/network.js";
import { CommandError } from "./CommandError.js";
import { CommandRouter } from "./CommandRouter.js";
import { CommandValidator } from "./CommandValidator.js";
import { EventBroadcaster } from "./EventBroadcaster.js";
import { GameStateStore } from "./GameStateStore.js";
import type { CardCatalog } from "../shared/types/cardCatalog.js";

export type HostServerOptions = {
  host?: string;
  port: number;
  cardCatalog?: CardCatalog;
};

export class HostServer {
  private readonly store: GameStateStore;
  private readonly validator = new CommandValidator();
  private readonly router: CommandRouter;
  private readonly connections = new Map<WebSocket, string>();
  private readonly broadcaster: EventBroadcaster;
  private server: WebSocketServer | null = null;

  constructor(private readonly options: HostServerOptions) {
    this.store = new GameStateStore(undefined, options.cardCatalog);
    this.router = new CommandRouter(this.store);
    this.broadcaster = new EventBroadcaster(this.store, () => this.connections.entries());
  }

  start(): void {
    this.server = new WebSocketServer({
      host: this.options.host,
      port: this.options.port
    });

    this.server.on("connection", (socket) => this.handleConnection(socket));
    this.server.on("listening", () => {
      const address = this.server?.address();
      const printableAddress =
        typeof address === "object" && address
          ? `${address.address}:${address.port}`
          : `${this.options.host ?? "0.0.0.0"}:${this.options.port}`;
      console.log(`Host server listening on ws://${printableAddress}`);
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  private handleConnection(socket: WebSocket): void {
    socket.on("message", (message) => this.handleMessage(socket, message));
    socket.on("close", () => {
      const playerId = this.connections.get(socket);
      this.connections.delete(socket);
      if (playerId) {
        this.store.markPlayerDisconnected(playerId);
        this.broadcaster.broadcastSnapshots();
      }
    });

    socket.send(
      JSON.stringify({
        type: "ROOM_INFO",
        payload: {
          roomId: this.store.getState().roomId,
          message: "Send JOIN_ROOM with { playerName, clientSessionId } to join."
        }
      })
    );
  }

  private handleMessage(socket: WebSocket, rawMessage: WebSocket.RawData): void {
    let command: GameCommand;

    try {
      command = this.validator.parse(rawMessage);
    } catch (error) {
      this.sendRejection(socket, error);
      return;
    }

    try {
      if (command.type === "JOIN_ROOM") {
        this.handleJoin(socket, command);
        return;
      }

      const playerId = this.connections.get(socket);
      if (!playerId) {
        throw new CommandError("NOT_JOINED", "Join the room before sending gameplay commands.");
      }

      const events = this.router.handlePlayerCommand(playerId, command);
      this.broadcaster.broadcast(events);
      this.broadcaster.broadcastSnapshots();
    } catch (error) {
      this.sendRejection(socket, error, command.requestId);
    }
  }

  private handleJoin(socket: WebSocket, command: Extract<GameCommand, { type: "JOIN_ROOM" }>): void {
    if (this.connections.has(socket)) {
      throw new CommandError("ALREADY_JOINED", "This connection already joined the room.");
    }

    const result = this.router.handleJoin(command);
    this.connections.set(socket, result.player.playerId);

    for (const event of result.privateEvents) {
      this.broadcaster.send(socket, event);
    }

    this.broadcaster.broadcast(result.broadcastEvents);
    this.broadcaster.broadcastSnapshots();
    console.log(`${result.player.name} joined as ${result.player.playerId}`);
  }

  private sendRejection(socket: WebSocket, error: unknown, requestId?: string): void {
    const commandError =
      error instanceof CommandError
        ? error
        : new CommandError("INTERNAL_ERROR", error instanceof Error ? error.message : "Unknown error.");
    this.broadcaster.send(socket, this.store.createCommandRejectedEvent(commandError, requestId));
  }
}
