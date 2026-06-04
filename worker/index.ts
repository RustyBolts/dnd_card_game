import { CommandError } from "../src/host/CommandError.js";
import { CommandRouter } from "../src/host/CommandRouter.js";
import { CommandValidator } from "../src/host/CommandValidator.js";
import { GameStateStore } from "../src/host/GameStateStore.js";
import type { GameCommand, GameEvent, NetworkMessage } from "../src/shared/types/network.js";

export type Env = {
  GAME_ROOMS: DurableObjectNamespace;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname === "/api/health") {
      return json({ status: "ok", service: "dnd-card-game-api" });
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return json({ error: "Expected a WebSocket upgrade request." }, 426);
      }

      const roomId = url.searchParams.get("room") || "main";
      const durableObjectId = env.GAME_ROOMS.idFromName(roomId);
      return env.GAME_ROOMS.get(durableObjectId).fetch(request);
    }

    return json({
      service: "dnd-card-game-api",
      websocket: "/ws?room=main",
      health: "/api/health"
    });
  }
};

export class GameRoom {
  private readonly store: GameStateStore;
  private readonly validator = new CommandValidator();
  private readonly router: CommandRouter;
  private readonly connections = new Map<WebSocket, string>();

  constructor(_state: DurableObjectState, _env: Env) {
    this.store = new GameStateStore("cloudflare_room");
    this.router = new CommandRouter(this.store);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "Expected a WebSocket upgrade request." }, 426);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.acceptConnection(server);

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  private acceptConnection(socket: WebSocket): void {
    socket.accept();
    this.send(socket, {
      type: "ROOM_INFO",
      payload: {
        roomId: this.store.getState().roomId,
        message: "Send JOIN_ROOM with { playerName } to join."
      }
    });

    socket.addEventListener("message", (event) => {
      this.handleMessage(socket, event.data).catch((error) => {
        this.sendRejection(socket, error);
      });
    });

    socket.addEventListener("close", () => this.handleClose(socket));
    socket.addEventListener("error", () => this.handleClose(socket));
  }

  private async handleMessage(socket: WebSocket, rawMessage: unknown): Promise<void> {
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
      this.broadcast(events);
      this.broadcastSnapshots();
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
      this.send(socket, event);
    }

    this.broadcast(result.broadcastEvents);
    this.broadcastSnapshots();
  }

  private handleClose(socket: WebSocket): void {
    const playerId = this.connections.get(socket);
    this.connections.delete(socket);

    if (playerId) {
      this.store.markPlayerDisconnected(playerId);
      this.broadcastSnapshots();
    }
  }

  private send(socket: WebSocket, message: NetworkMessage | GameEvent): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  private broadcast(events: GameEvent[]): void {
    for (const event of events) {
      for (const [socket, playerId] of this.connections.entries()) {
        this.send(socket, redactPrivateEvent(event, playerId));
      }
    }
  }

  private broadcastSnapshots(): void {
    for (const [socket, playerId] of this.connections.entries()) {
      this.send(socket, this.store.createSnapshotEvent(playerId));
    }
  }

  private sendRejection(socket: WebSocket, error: unknown, requestId?: string): void {
    const commandError =
      error instanceof CommandError
        ? error
        : new CommandError("INTERNAL_ERROR", error instanceof Error ? error.message : "Unknown error.");
    this.send(socket, this.store.createCommandRejectedEvent(commandError, requestId));
  }
}

function redactPrivateEvent(event: GameEvent, recipientPlayerId: string): GameEvent {
  if (event.type !== "CARD_DRAWN" || event.payload.playerId === recipientPlayerId) {
    return event;
  }

  return {
    ...event,
    payload: {
      playerId: event.payload.playerId,
      cardInstanceId: event.payload.cardInstanceId
    }
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders()
    }
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
