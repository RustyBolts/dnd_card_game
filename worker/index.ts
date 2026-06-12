import { CommandError } from "../src/host/CommandError.js";
import { CommandRouter } from "../src/host/CommandRouter.js";
import { CommandValidator } from "../src/host/CommandValidator.js";
import { GameStateStore } from "../src/host/GameStateStore.js";
import { redactPrivateEvent } from "../src/shared/rules/eventPrivacy.js";
import type { GameCommand, GameEvent, NetworkMessage } from "../src/shared/types/network.js";
import {
  loadWorkerCardCatalog,
  syncWorkerCardCatalog,
  type WorkerCardCatalogResult
} from "./cardCatalog.js";

export type Env = {
  GAME_ROOMS: DurableObjectNamespace;
  ROOM_LOBBY: DurableObjectNamespace;
  CARD_CATALOG_KV?: KVNamespace;
  CARD_CATALOG_KEY?: string;
  CARD_CARDS_CSV_URL?: string;
  CARD_STARTER_DECK_CSV_URL?: string;
  CARD_TRANSFORM_RULES_CSV_URL?: string;
  CARD_RACES_CSV_URL?: string;
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

    if (url.pathname === "/api/rooms" || url.pathname === "/api/rooms/join") {
      return getRoomLobby(env).fetch(request);
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
          starterDeckSize: catalog.starterDeckCardIds.length,
          transformRuleCount: catalog.transformRules.length,
          raceCount: Object.keys(catalog.races ?? {}).length
        });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Unable to sync card catalog." }, 500);
      }
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return json({ error: "Expected a WebSocket upgrade request." }, 426);
      }

      let roomId: string;
      try {
        roomId = normalizeRoomId(url.searchParams.get("room") || "main");
      } catch (error) {
        return commandErrorJson(error);
      }

      const token = url.searchParams.get("token") ?? "";
      const tokenValidation = await validateJoinToken(env, roomId, token);
      if (tokenValidation) {
        return tokenValidation;
      }

      const durableObjectId = env.GAME_ROOMS.idFromName(roomId);
      return env.GAME_ROOMS.get(durableObjectId).fetch(request);
    }

    return json({
      service: "dnd-card-game-api",
      websocket: "/ws?room=main&token=<join-token>",
      health: "/api/health",
      rooms: "/api/rooms",
      cardCatalog: "/api/card-catalog",
      syncCardCatalog: "/api/admin/card-catalog/sync"
    });
  }
};

type RoomRegistry = {
  rooms: Record<string, RoomRecord>;
  tokens: Record<string, JoinTokenRecord>;
};

type RoomRecord = {
  roomId: string;
  isPrivate: boolean;
  passwordHash?: string;
  createdAt: number;
  updatedAt: number;
};

type JoinTokenRecord = {
  roomId: string;
  expiresAt: number;
};

type RoomSummary = {
  roomId: string;
  isPrivate: boolean;
  createdAt: number;
  updatedAt: number;
};

const LOBBY_OBJECT_NAME = "global";
const ROOM_REGISTRY_KEY = "room-registry";
const JOIN_TOKEN_TTL_MS = 15 * 60 * 1000;

export class RoomLobby {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      if (url.pathname === "/api/rooms" && request.method === "GET") {
        return json({ rooms: this.listPublicRooms(await this.loadRegistry()) });
      }

      if (url.pathname === "/api/rooms" && request.method === "POST") {
        return this.createRoom(request);
      }

      if (url.pathname === "/api/rooms/join" && request.method === "POST") {
        return this.joinRoom(request);
      }

      if (url.pathname === "/internal/validate-token" && request.method === "POST") {
        return this.validateToken(request);
      }

      return json({ error: "Not found." }, 404);
    } catch (error) {
      return commandErrorJson(error);
    }
  }

  private async createRoom(request: Request): Promise<Response> {
    const body = await readJsonObject(request);
    const requestedRoomId = typeof body.roomId === "string" ? body.roomId : "";
    const roomId = normalizeRoomId(requestedRoomId || createGeneratedRoomId());
    const password = typeof body.password === "string" ? body.password.trim() : "";
    const registry = await this.loadRegistry();

    if (registry.rooms[roomId]) {
      return json({ error: `Room ${roomId} already exists.` }, 409);
    }

    const now = Date.now();
    const room: RoomRecord = {
      roomId,
      isPrivate: password.length > 0,
      passwordHash: password.length > 0 ? await hashRoomPassword(roomId, password) : undefined,
      createdAt: now,
      updatedAt: now
    };

    registry.rooms[roomId] = room;
    const joinToken = this.issueJoinToken(registry, roomId, now);
    await this.saveRegistry(registry);

    return json({
      room: summarizeRoom(room),
      joinToken
    }, 201);
  }

  private async joinRoom(request: Request): Promise<Response> {
    const body = await readJsonObject(request);
    const roomIdInput = typeof body.roomId === "string" ? body.roomId : "";
    const password = typeof body.password === "string" ? body.password.trim() : "";
    const roomId = normalizeRoomId(roomIdInput);
    const registry = await this.loadRegistry();
    const room = registry.rooms[roomId];

    if (!room) {
      return json({ error: `Room ${roomId} does not exist.` }, 404);
    }

    if (room.isPrivate) {
      if (!password) {
        return json({ error: "Room password is required." }, 401);
      }

      const passwordHash = await hashRoomPassword(room.roomId, password);
      if (passwordHash !== room.passwordHash) {
        return json({ error: "Room password is incorrect." }, 403);
      }
    }

    const now = Date.now();
    room.updatedAt = now;
    const joinToken = this.issueJoinToken(registry, room.roomId, now);
    await this.saveRegistry(registry);

    return json({
      room: summarizeRoom(room),
      joinToken
    });
  }

  private async validateToken(request: Request): Promise<Response> {
    const body = await readJsonObject(request);
    const roomId = normalizeRoomId(typeof body.roomId === "string" ? body.roomId : "");
    const token = typeof body.token === "string" ? body.token : "";
    const registry = await this.loadRegistry();
    const now = Date.now();
    this.pruneExpiredTokens(registry, now);

    const tokenRecord = registry.tokens[token];
    if (!tokenRecord || tokenRecord.roomId !== roomId || tokenRecord.expiresAt <= now) {
      await this.saveRegistry(registry);
      return json({ error: "Room join token is invalid or expired." }, 403);
    }

    await this.saveRegistry(registry);
    return json({ ok: true });
  }

  private issueJoinToken(registry: RoomRegistry, roomId: string, now: number): string {
    this.pruneExpiredTokens(registry, now);
    const token = crypto.randomUUID();
    registry.tokens[token] = {
      roomId,
      expiresAt: now + JOIN_TOKEN_TTL_MS
    };
    return token;
  }

  private pruneExpiredTokens(registry: RoomRegistry, now: number): void {
    for (const [token, record] of Object.entries(registry.tokens)) {
      if (record.expiresAt <= now) {
        delete registry.tokens[token];
      }
    }
  }

  private listPublicRooms(registry: RoomRegistry): RoomSummary[] {
    return Object.values(registry.rooms)
      .filter((room) => !room.isPrivate)
      .map(summarizeRoom)
      .sort((a, b) => a.roomId.localeCompare(b.roomId, "zh-Hant"));
  }

  private async loadRegistry(): Promise<RoomRegistry> {
    const registry = await this.state.storage.get<RoomRegistry>(ROOM_REGISTRY_KEY) ?? {
      rooms: {},
      tokens: {}
    };

    if (!registry.rooms.main) {
      const now = Date.now();
      registry.rooms.main = {
        roomId: "main",
        isPrivate: false,
        createdAt: now,
        updatedAt: now
      };
      await this.saveRegistry(registry);
    }

    return registry;
  }

  private async saveRegistry(registry: RoomRegistry): Promise<void> {
    await this.state.storage.put(ROOM_REGISTRY_KEY, registry);
  }
}

async function validateJoinToken(env: Env, roomId: string, token: string): Promise<Response | null> {
  const response = await getRoomLobby(env).fetch(
    new Request("https://room-lobby/internal/validate-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ roomId, token })
    })
  );

  if (response.ok) {
    return null;
  }

  let message = "Room join token is invalid or expired.";
  try {
    const body = await response.json<{ error?: string }>();
    message = body.error ?? message;
  } catch {
    // Keep the default rejection message.
  }

  return json({ error: message }, response.status);
}

function getRoomLobby(env: Env): DurableObjectStub {
  return env.ROOM_LOBBY.get(env.ROOM_LOBBY.idFromName(LOBBY_OBJECT_NAME));
}

function summarizeRoom(room: RoomRecord): RoomSummary {
  return {
    roomId: room.roomId,
    isPrivate: room.isPrivate,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt
  };
}

function createGeneratedRoomId(): string {
  return `room-${crypto.randomUUID().slice(0, 8)}`;
}

function normalizeRoomId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(normalized)) {
    throw new CommandError(
      "INVALID_ROOM_ID",
      "Room code must be 2-32 characters and only use letters, numbers, hyphen, or underscore."
    );
  }

  return normalized;
}

async function hashRoomPassword(roomId: string, password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`dnd-card-game:${roomId}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

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

    const url = new URL(request.url);
    const roomId = normalizeRoomId(url.searchParams.get("room") || "main");
    const runtime = await this.ensureRuntime(roomId);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.acceptConnection(server, runtime.store);

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  private async ensureRuntime(roomId: string): Promise<GameRoomRuntime> {
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

    this.runtimePromise ??= this.createRuntime(roomId);
    this.runtime = await this.runtimePromise;
    return this.runtime;
  }

  private async createRuntime(roomId: string): Promise<GameRoomRuntime> {
    const { catalog } = await loadWorkerCardCatalog(this.env);
    const store = new GameStateStore(roomId, catalog);

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
        message: "Send JOIN_ROOM with { playerName, clientSessionId } to join."
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
      const runtime = await this.ensureRuntime(this.runtime?.store.getState().roomId ?? "main");

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
        const visibleEvent = redactPrivateEvent(event, playerId);
        if (visibleEvent) {
          this.send(socket, visibleEvent);
        }
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
    transformRuleCount: result.catalog.transformRules.length,
    raceCount: Object.keys(result.catalog.races ?? {}).length,
    races: result.catalog.races,
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

function commandErrorJson(error: unknown): Response {
  if (error instanceof CommandError) {
    return json({ error: error.message, code: error.code }, 400);
  }

  return json({ error: error instanceof Error ? error.message : "Unexpected request error." }, 500);
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
