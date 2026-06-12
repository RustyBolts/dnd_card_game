import { createServer } from "node:net";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { HostServer } from "../src/host/HostServer.js";
import { createDefaultCharacterConfig } from "../src/shared/rules/characterRules.js";
import type { NetworkMessage } from "../src/shared/types/network.js";

const openSockets: WebSocket[] = [];
let activeServer: HostServer | null = null;

afterEach(() => {
  for (const socket of openSockets.splice(0)) {
    socket.close();
  }
  activeServer?.stop();
  activeServer = null;
});

describe("HostServer websocket flow", () => {
  it("accepts two players, processes ready commands, and starts the game", async () => {
    const port = await getFreePort();
    activeServer = new HostServer({ host: "127.0.0.1", port });
    activeServer.start();

    const alice = await connect(`ws://127.0.0.1:${port}`);
    const bob = await connect(`ws://127.0.0.1:${port}`);
    const aliceMessages: NetworkMessage[] = [];
    const bobMessages: NetworkMessage[] = [];

    alice.on("message", (message) => aliceMessages.push(parseMessage(message)));
    bob.on("message", (message) => bobMessages.push(parseMessage(message)));

    alice.send(JSON.stringify(createJoinCommand("join_a", "Alice")));
    bob.send(JSON.stringify(createJoinCommand("join_b", "Bob")));

    await waitFor(() => aliceMessages.some((message) => message.type === "JOIN_ACCEPTED"));
    await waitFor(() => bobMessages.some((message) => message.type === "JOIN_ACCEPTED"));

    alice.send(JSON.stringify(createSetCharacterCommand("character_a")));
    bob.send(JSON.stringify(createSetCharacterCommand("character_b")));

    await waitFor(() => aliceMessages.some((message) => message.type === "PLAYER_CHARACTER_UPDATED"));
    await waitFor(() => bobMessages.some((message) => message.type === "PLAYER_CHARACTER_UPDATED"));

    alice.send(JSON.stringify({ type: "PLAYER_READY", requestId: "ready_a" }));
    bob.send(JSON.stringify({ type: "PLAYER_READY", requestId: "ready_b" }));

    await waitFor(() =>
      aliceMessages.some(
        (message) =>
          message.type === "GAME_STATE_SYNC" &&
          isRecord(message.payload) &&
          isRecord(message.payload.state) &&
          message.payload.state.status === "PLAYING"
      )
    );
    await waitFor(() => bobMessages.some((message) => message.type === "GAME_STARTED"));

    expect(aliceMessages.some((message) => message.type === "GAME_STARTED")).toBe(true);
    expect(bobMessages.some((message) => message.type === "GAME_STARTED")).toBe(true);
  });
});

function createJoinCommand(requestId: string, playerName: string): unknown {
  return {
    type: "JOIN_ROOM",
    requestId,
    payload: {
      playerName,
      clientSessionId: `${requestId}_session`
    }
  };
}

function createSetCharacterCommand(requestId: string): unknown {
  return {
    type: "SET_CHARACTER",
    requestId,
    payload: {
      character: createDefaultCharacterConfig()
    }
  };
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    openSockets.push(socket);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function parseMessage(message: WebSocket.RawData): NetworkMessage {
  return JSON.parse(message.toString("utf8")) as NetworkMessage;
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || !address) {
        reject(new Error("Unable to allocate a test port."));
        return;
      }

      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for websocket condition.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
