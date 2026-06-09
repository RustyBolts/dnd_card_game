import {
  getCardTargeting,
  getSelectableTargetIds
} from "../../src/shared/rules/cardTargets";
import type { CardTargeting, VisibleCardInstance } from "../../src/shared/types/card";
import type { VisibleGameState } from "../../src/shared/types/game";
import type { GameEvent, GameStateSyncEvent, JoinAcceptedEvent, NetworkMessage } from "../../src/shared/types/network";
import "./styles.css";

const connectForm = byId<HTMLFormElement>("connect-form");
const playerNameInput = byId<HTMLInputElement>("player-name");
const roomIdInput = byId<HTMLInputElement>("room-id");
const workerUrlInput = byId<HTMLInputElement>("worker-url");
const connectionStatus = byId<HTMLElement>("connection-status");
const playersEl = byId<HTMLElement>("players");
const gameStatusEl = byId<HTMLElement>("game-status");
const turnLabel = byId<HTMLElement>("turn-label");
const currentPlayerEl = byId<HTMLElement>("current-player");
const readyButton = byId<HTMLButtonElement>("ready-button");
const drawButton = byId<HTMLButtonElement>("draw-button");
const endButton = byId<HTMLButtonElement>("end-button");
const handEl = byId<HTMLElement>("hand");
const eventLog = byId<HTMLOListElement>("event-log");

let socket: WebSocket | null = null;
let playerId: string | null = null;
let localState: VisibleGameState | null = null;

workerUrlInput.value = import.meta.env.VITE_WORKER_WS_URL || defaultWorkerUrl();

connectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  connect();
});

readyButton.addEventListener("click", () => send({ type: "PLAYER_READY", requestId: requestId() }));
drawButton.addEventListener("click", () => send({ type: "DRAW_CARD", requestId: requestId() }));
endButton.addEventListener("click", () => send({ type: "END_TURN", requestId: requestId() }));

render();

function connect(): void {
  socket?.close();

  const roomId = encodeURIComponent(roomIdInput.value.trim() || "main");
  const url = new URL(workerUrlInput.value.trim() || defaultWorkerUrl());
  url.searchParams.set("room", roomId);

  socket = new WebSocket(url);
  connectionStatus.textContent = "Connecting";

  socket.addEventListener("open", () => {
    connectionStatus.textContent = "Online";
    send({
      type: "JOIN_ROOM",
      requestId: requestId(),
      payload: {
        playerName: playerNameInput.value.trim() || "Player"
      }
    });
  });

  socket.addEventListener("message", (event) => handleMessage(event.data));
  socket.addEventListener("close", () => {
    connectionStatus.textContent = "Offline";
    render();
  });
  socket.addEventListener("error", () => {
    connectionStatus.textContent = "Connection error";
  });
}

function handleMessage(rawMessage: string): void {
  const message = JSON.parse(rawMessage) as NetworkMessage | GameEvent;

  if (isJoinAccepted(message)) {
    playerId = message.payload.playerId;
  }

  if (isGameStateSync(message)) {
    localState = message.payload.state;
  }

  addLog(message);
  render();
}

function render(): void {
  const isOnline = socket?.readyState === WebSocket.OPEN;
  readyButton.disabled = !isOnline;
  drawButton.disabled = !isOnline;
  endButton.disabled = !isOnline;

  if (!localState) {
    playersEl.innerHTML = `<p class="muted">No players</p>`;
    gameStatusEl.textContent = "WAITING";
    turnLabel.textContent = "Turn 0";
    currentPlayerEl.textContent = "Current: none";
    handEl.innerHTML = `<div class="empty-card">Connect to a room</div>`;
    return;
  }

  gameStatusEl.textContent = localState.status;
  turnLabel.textContent = `Turn ${localState.turn}`;
  const currentPlayerName = localState.currentPlayerId
    ? localState.players[localState.currentPlayerId]?.name ?? localState.currentPlayerId
    : "none";
  currentPlayerEl.textContent = `Current: ${currentPlayerName}`;

  playersEl.innerHTML = localState.playerOrder
    .map((id) => {
      const player = localState!.players[id];
      const isCurrent = localState!.currentPlayerId === id;
      return `
        <div class="player ${isCurrent ? "current" : ""}">
          <div>
            <strong>${escapeHtml(player.name)}</strong>
            <span>${id}</span>
          </div>
          <div>HP ${player.hp}</div>
          <div>Energy ${player.energy}/${player.maxEnergy}</div>
          <div>Hand ${localState!.zones.handCounts[id] ?? 0} · Deck ${localState!.zones.deckCounts[id] ?? 0}</div>
        </div>
      `;
    })
    .join("");

  const hand = playerId ? localState.zones.hand[playerId] ?? [] : [];
  handEl.innerHTML =
    hand.length > 0
      ? hand.map((card) => renderCard(card)).join("")
      : `<div class="empty-card">Hand is empty</div>`;
}

function renderCard(card: VisibleCardInstance): string {
  const targeting = getCardTargeting(card);
  const targetControl = renderTargetControl(card, targeting);
  const isPlayDisabled = targeting.requiresTarget && getTargetOptions(targeting).length === 0;

  return `
    <article class="card">
      <div class="card-cost">${card.cost ?? 0}</div>
      <h3>${escapeHtml(card.name ?? card.cardId)}</h3>
      <p>${escapeHtml(card.description ?? "")}</p>
      <div class="card-meta">
        <span>${targetingLabel(targeting)}</span>
      </div>
      ${targetControl}
      <div class="card-actions">
        <button type="button" data-play="${card.instanceId}" ${isPlayDisabled ? "disabled" : ""}>Play</button>
        <button type="button" data-discard="${card.instanceId}">Discard</button>
      </div>
    </article>
  `;
}

function renderTargetControl(card: VisibleCardInstance, targeting: CardTargeting): string {
  if (!targeting.requiresTarget) {
    return "";
  }

  const options = getTargetOptions(targeting);
  if (options.length === 0) {
    return `<p class="muted card-target-empty">No valid target</p>`;
  }

  return `
    <label class="card-target">
      Target
      <select data-target-for="${escapeHtml(card.instanceId)}">
        ${options
          .map((id) => `<option value="${id}">${escapeHtml(localState!.players[id].name)} (${id})</option>`)
          .join("")}
      </select>
    </label>
  `;
}

function getTargetOptions(targeting: CardTargeting): string[] {
  if (!localState || !playerId) {
    return [];
  }

  return getSelectableTargetIds(localState, playerId, targeting);
}

handEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  const playId = target.dataset.play;
  if (playId) {
    const card = findVisibleHandCard(playId);
    const selectedTargetId = selectedTargetForCard(playId);
    const targeting = card ? getCardTargeting(card) : null;

    if (targeting?.requiresTarget && !selectedTargetId) {
      addLog({ type: "LOCAL_NOTICE", payload: { message: "No valid target selected." } });
      return;
    }

    send({
      type: "PLAY_CARD",
      requestId: requestId(),
      payload: {
        cardInstanceId: playId,
        targetId: selectedTargetId
      }
    });
    return;
  }

  const discardId = target.dataset.discard;
  if (discardId) {
    send({
      type: "DISCARD_CARD",
      requestId: requestId(),
      payload: {
        cardInstanceId: discardId
      }
    });
  }
});

function send(command: unknown): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    addLog({ type: "LOCAL_NOTICE", payload: { message: "Socket is not connected." } });
    return;
  }

  socket.send(JSON.stringify(command));
}

function findVisibleHandCard(cardInstanceId: string): VisibleCardInstance | undefined {
  if (!localState || !playerId) {
    return undefined;
  }

  return (localState.zones.hand[playerId] ?? []).find((card) => card.instanceId === cardInstanceId);
}

function selectedTargetForCard(cardInstanceId: string): string | undefined {
  const select = Array.from(handEl.querySelectorAll<HTMLSelectElement>("select[data-target-for]"))
    .find((candidate) => candidate.dataset.targetFor === cardInstanceId);
  return select?.value || undefined;
}

function addLog(message: NetworkMessage | GameEvent): void {
  const item = document.createElement("li");
  const detail = message.type === "COMMAND_REJECTED" && isRecord(message.payload)
    ? ` ${message.payload.code}: ${message.payload.message}`
    : "";
  item.textContent = `${new Date().toLocaleTimeString()} ${message.type}${detail}`;
  eventLog.prepend(item);

  while (eventLog.children.length > 30) {
    eventLog.lastElementChild?.remove();
  }
}

function defaultWorkerUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }

  return element as T;
}

function requestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isJoinAccepted(message: NetworkMessage | GameEvent): message is JoinAcceptedEvent {
  return message.type === "JOIN_ACCEPTED" && typeof message.seq === "number";
}

function isGameStateSync(message: NetworkMessage | GameEvent): message is GameStateSyncEvent {
  return message.type === "GAME_STATE_SYNC" && typeof message.seq === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function targetingLabel(targeting: CardTargeting): string {
  const scope = {
    SELF: "Self",
    ALLY: "Ally",
    ENEMY: "Enemy",
    ANY: "Any"
  }[targeting.scope];
  const selection = {
    NONE: "No target",
    SINGLE: "Single",
    GROUP: "Group"
  }[targeting.selection];

  return `${scope} · ${selection}`;
}
