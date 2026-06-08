import { CommandError } from "../src/host/CommandError.js";
import { CommandRouter } from "../src/host/CommandRouter.js";
import { CommandValidator } from "../src/host/CommandValidator.js";
import { GameStateStore } from "../src/host/GameStateStore.js";
import type { GameCommand, GameEvent, NetworkMessage } from "../src/shared/types/network.js";
import {
  loadWorkerCardCatalog,
  syncWorkerCardCatalog,
  type WorkerCardCatalogResult
} from "./cardCatalog.js";

export type Env = {
  GAME_ROOMS: DurableObjectNamespace;
  CARD_CATALOG_KV?: KVNamespace;
  CARD_CATALOG_KEY?: string;
  CARD_CARDS_CSV_URL?: string;
  CARD_STARTER_DECK_CSV_URL?: string;
  CARD_CATALOG_ADMIN_TOKEN?: string;
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

    if (url.pathname === "/api/card-catalog" && request.method === "GET") {
      const result = await loadWorkerCardCatalog(env);
      return json(cardCatalogResponse(result));
    }

    if (url.pathname === "/api/admin/card-catalog/sync" && request.method === "POST") {
      const authError = authorizeAdmin(request, env);
      if (authError) {
        return authError;
      }

      try {
        const catalog = await syncWorkerCardCatalog(env);
        return json({
          status: "ok",
          version: catalog.version,
          cardCount: Object.keys(catalog.cardDefinitions).length,
          starterDeckSize: catalog.starterDeckCardIds.length
        });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Unable to sync card catalog." }, 500);
      }
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
      health: "/api/health",
      cardCatalog: "/api/card-catalog",
      syncCardCatalog: "/api/admin/card-catalog/sync"
    });
  }
};

type GameRoomRuntime = {
  store: GameStateStore;
  router: CommandRouter;
};

export class GameRoom {
  private readonly validator = new CommandValidator();
  private readonly connections = new Map<WebSocket, string>();
  private runtime: GameRoomRuntime | null = null;
  private runtimePromise: Promise<GameRoomRuntime> | null = null;

  constructor(_state: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "Expected a WebSocket upgrade request." }, 426);
    }

    const runtime = await this.ensureRuntime();
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.acceptConnection(server, runtime.store);

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  private async ensureRuntime(): Promise<GameRoomRuntime> {
    if (this.runtime) {
      if (this.shouldRefreshIdleRuntime(this.runtime)) {
        this.runtimePromise = null;
        this.runtime = null;
      } else {
        return this.runtime;
      }
    }

    if (this.runtime) {
      return this.runtime;
    }

    this.runtimePromise ??= this.createRuntime();
    this.runtime = await this.runtimePromise;
    return this.runtime;
  }

  private async createRuntime(): Promise<GameRoomRuntime> {
    const { catalog } = await loadWorkerCardCatalog(this.env);
    const store = new GameStateStore("cloudflare_room", catalog);

    return {
      store,
      router: new CommandRouter(store)
    };
  }

  private shouldRefreshIdleRuntime(runtime: GameRoomRuntime): boolean {
    return this.connections.size === 0 && runtime.store.getState().status === "WAITING";
  }

  private acceptConnection(socket: WebSocket, store: GameStateStore): void {
    socket.accept();
    this.send(socket, {
      type: "ROOM_INFO",
      payload: {
        roomId: store.getState().roomId,
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
      const runtime = await this.ensureRuntime();

      if (command.type === "JOIN_ROOM") {
        this.handleJoin(socket, command, runtime);
        return;
      }

      const playerId = this.connections.get(socket);
      if (!playerId) {
        throw new CommandError("NOT_JOINED", "Join the room before sending gameplay commands.");
      }

      const events = runtime.router.handlePlayerCommand(playerId, command);
      this.broadcast(events);
      this.broadcastSnapshots();
    } catch (error) {
      this.sendRejection(socket, error, command.requestId);
    }
  }

  private handleJoin(
    socket: WebSocket,
    command: Extract<GameCommand, { type: "JOIN_ROOM" }>,
    runtime: GameRoomRuntime
  ): void {
    if (this.connections.has(socket)) {
      throw new CommandError("ALREADY_JOINED", "This connection already joined the room.");
    }

    const result = runtime.router.handleJoin(command);
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

    if (playerId && this.runtime) {
      this.runtime.store.markPlayerDisconnected(playerId);
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
    if (!this.runtime) {
      return;
    }

    for (const [socket, playerId] of this.connections.entries()) {
      this.send(socket, this.runtime.store.createSnapshotEvent(playerId));
    }
  }

  private sendRejection(socket: WebSocket, error: unknown, requestId?: string): void {
    const commandError =
      error instanceof CommandError
        ? error
        : new CommandError("INTERNAL_ERROR", error instanceof Error ? error.message : "Unknown error.");
    const store = this.runtime?.store ?? new GameStateStore("cloudflare_room");
    this.send(socket, store.createCommandRejectedEvent(commandError, requestId));
  }
}

function cardCatalogResponse(result: WorkerCardCatalogResult): Record<string, unknown> {
  return {
    source: result.source,
    version: result.catalog.version,
    cardCount: Object.keys(result.catalog.cardDefinitions).length,
    starterDeckSize: result.catalog.starterDeckCardIds.length,
    cardDefinitions: result.catalog.cardDefinitions
  };
}

function authorizeAdmin(request: Request, env: Env): Response | null {
  if (!env.CARD_CATALOG_ADMIN_TOKEN) {
    return json({ error: "CARD_CATALOG_ADMIN_TOKEN is not configured." }, 503);
  }

  if (request.headers.get("Authorization") !== `Bearer ${env.CARD_CATALOG_ADMIN_TOKEN}`) {
    return json({ error: "Unauthorized." }, 401);
  }

  return null;
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type"
  };
}
