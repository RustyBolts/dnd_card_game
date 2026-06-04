import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { GameClient } from "./GameClient.js";
import type { VisibleGameState } from "../shared/types/game.js";
import type { CommandRejectedEvent, GameStateSyncEvent, NetworkMessage } from "../shared/types/network.js";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (key?.startsWith("--") && value) {
    args.set(key.slice(2), value);
  }
}

const url = args.get("url") ?? process.env.GAME_URL ?? "ws://localhost:7777";
const playerName = args.get("name") ?? process.env.PLAYER_NAME ?? `Player_${Math.floor(Math.random() * 1000)}`;

const client = new GameClient({ url, playerName });
client.onEvent((event) => {
  if (isGameStateSyncEvent(event)) {
    renderSummary(event.payload.state);
    return;
  }

  if (isCommandRejectedEvent(event)) {
    console.log(`[rejected] ${event.payload.code}: ${event.payload.message}`);
    return;
  }

  if (event.type !== "ROOM_INFO") {
    console.log(`[event] ${event.type}`);
  }
});

await client.connect();
console.log(`Connected to ${url} as ${playerName}.`);
printHelp();

const rl = createInterface({ input, output });

while (true) {
  const line = (await rl.question("> ")).trim();
  const [command, ...parts] = line.split(/\s+/);

  try {
    if (!command) {
      continue;
    }

    if (command === "quit" || command === "exit") {
      break;
    }

    if (command === "help") {
      printHelp();
      continue;
    }

    if (command === "ready") {
      client.commands.ready();
      continue;
    }

    if (command === "draw") {
      client.commands.draw();
      continue;
    }

    if (command === "play") {
      const [cardInstanceId, targetId] = parts;
      if (!cardInstanceId) {
        console.log("Usage: play <cardInstanceId> [targetPlayerId]");
        continue;
      }
      client.commands.play(cardInstanceId, targetId);
      continue;
    }

    if (command === "discard") {
      const [cardInstanceId] = parts;
      if (!cardInstanceId) {
        console.log("Usage: discard <cardInstanceId>");
        continue;
      }
      client.commands.discard(cardInstanceId);
      continue;
    }

    if (command === "end") {
      client.commands.endTurn();
      continue;
    }

    if (command === "hand") {
      renderHand(client.localState.state, client.localState.playerId);
      continue;
    }

    if (command === "state") {
      renderState(client.localState.state);
      continue;
    }

    if (command === "players") {
      renderPlayers(client.localState.state);
      continue;
    }

    console.log(`Unknown command: ${command}`);
  } catch (error) {
    console.log(error instanceof Error ? error.message : String(error));
  }
}

rl.close();
client.close();

function printHelp(): void {
  console.log("Commands: ready, draw, hand, play <cardInstanceId> [targetPlayerId], discard <cardInstanceId>, end, state, players, help, quit");
}

function isGameStateSyncEvent(event: NetworkMessage): event is GameStateSyncEvent {
  return event.type === "GAME_STATE_SYNC" && typeof event.seq === "number";
}

function isCommandRejectedEvent(event: NetworkMessage): event is CommandRejectedEvent {
  return event.type === "COMMAND_REJECTED" && typeof event.seq === "number";
}

function renderSummary(state: VisibleGameState): void {
  const current = state.currentPlayerId ? state.players[state.currentPlayerId]?.name ?? state.currentPlayerId : "none";
  console.log(`[state] ${state.status} turn=${state.turn} current=${current}`);
}

function renderHand(state: VisibleGameState | null, playerId: string | null): void {
  if (!state || !playerId) {
    console.log("No local state yet.");
    return;
  }

  const hand = state.zones.hand[playerId] ?? [];
  if (hand.length === 0) {
    console.log("Hand is empty.");
    return;
  }

  for (const card of hand) {
    console.log(`${card.instanceId} | ${card.name} | cost=${card.cost} | ${card.description}`);
  }
}

function renderPlayers(state: VisibleGameState | null): void {
  if (!state) {
    console.log("No local state yet.");
    return;
  }

  for (const playerId of state.playerOrder) {
    const player = state.players[playerId];
    const marker = state.currentPlayerId === playerId ? "*" : " ";
    console.log(`${marker} ${playerId} ${player.name} hp=${player.hp} energy=${player.energy}/${player.maxEnergy} ready=${player.ready} hand=${state.zones.handCounts[playerId]} deck=${state.zones.deckCounts[playerId]}`);
  }
}

function renderState(state: VisibleGameState | null): void {
  if (!state) {
    console.log("No local state yet.");
    return;
  }

  console.log(JSON.stringify(state, null, 2));
}
