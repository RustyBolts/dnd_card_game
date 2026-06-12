import {
  getAutomaticTargetIds,
  getCardTargeting,
  getSelectableTargetIds
} from "../../src/shared/rules/cardTargets";
import {
  CREATION_ABILITY_MIN,
  CREATION_POINT_BUDGET,
  DEFAULT_RACES,
  calculateAbilityModifiers,
  calculateCreationPointSpend,
  validateAndCreateCharacter
} from "../../src/shared/rules/characterRules";
import type { CardDefinition, CardTargeting, VisibleCardInstance } from "../../src/shared/types/card";
import {
  ABILITY_KEYS,
  type AbilityKey,
  type AbilityScores,
  type RaceDefinition
} from "../../src/shared/types/character";
import type { VisibleGameState } from "../../src/shared/types/game";
import type { GameEvent, GameStateSyncEvent, JoinAcceptedEvent, NetworkMessage } from "../../src/shared/types/network";
import "./styles.css";

const connectForm = byId<HTMLFormElement>("connect-form");
const playerNameInput = byId<HTMLInputElement>("player-name");
const roomIdInput = byId<HTMLInputElement>("room-id");
const workerUrlInput = byId<HTMLInputElement>("worker-url");
const connectionStatus = byId<HTMLElement>("connection-status");
const raceOptionsEl = byId<HTMLElement>("race-options");
const abilityControlsEl = byId<HTMLElement>("ability-controls");
const abilityPointsEl = byId<HTMLElement>("ability-points");
const characterSummaryEl = byId<HTMLElement>("character-summary");
const catalogStatusEl = byId<HTMLElement>("catalog-status");
const playersEl = byId<HTMLElement>("players");
const gameStatusEl = byId<HTMLElement>("game-status");
const turnLabel = byId<HTMLElement>("turn-label");
const currentPlayerEl = byId<HTMLElement>("current-player");
const readyButton = byId<HTMLButtonElement>("ready-button");
const drawButton = byId<HTMLButtonElement>("draw-button");
const endButton = byId<HTMLButtonElement>("end-button");
const pileControlsEl = byId<HTMLElement>("pile-controls");
const drawPreviewEl = byId<HTMLElement>("draw-preview");
const handEl = byId<HTMLElement>("hand");
const eventLog = byId<HTMLOListElement>("event-log");
const pileDialog = byId<HTMLDialogElement>("pile-dialog");
const pileDialogTitle = byId<HTMLElement>("pile-dialog-title");
const pileDialogBody = byId<HTMLElement>("pile-dialog-body");
const pileDialogClose = byId<HTMLButtonElement>("pile-dialog-close");

let socket: WebSocket | null = null;
let playerId: string | null = null;
let localState: VisibleGameState | null = null;
let cardDefinitions: Record<string, CardDefinition> = {};
let races: Record<string, RaceDefinition> = DEFAULT_RACES;
let selectedRaceId = Object.keys(DEFAULT_RACES)[0] ?? "human";
let raceCatalogLoaded = false;
let raceCatalogLoading = false;
let raceCatalogStatus = "Using local default races until a Worker catalog is loaded.";
let abilityScores: AbilityScores = {
  strength: 12,
  dexterity: 12,
  intelligence: 12,
  wisdom: 12,
  charisma: 12,
  constitution: 12
};

workerUrlInput.value = import.meta.env.VITE_WORKER_WS_URL || defaultWorkerUrl();

connectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void connect();
});

workerUrlInput.addEventListener("change", () => {
  void refreshCatalogFromWorkerUrl();
});
workerUrlInput.addEventListener("blur", () => {
  void refreshCatalogFromWorkerUrl();
});
readyButton.addEventListener("click", () => send({ type: "PLAYER_READY", requestId: requestId() }));
drawButton.addEventListener("click", () => send({ type: "DRAW_CARD", requestId: requestId() }));
endButton.addEventListener("click", () => send({ type: "END_TURN", requestId: requestId() }));
pileDialogClose.addEventListener("click", () => pileDialog.close());

render();
void refreshCatalogFromWorkerUrl();

async function connect(): Promise<void> {
  socket?.close();

  const roomId = encodeURIComponent(roomIdInput.value.trim() || "main");
  const url = new URL(workerUrlInput.value.trim() || defaultWorkerUrl());
  url.searchParams.set("room", roomId);
  await refreshCatalogFromWorkerUrl();

  const character = readCharacterConfig();
  if (!character) {
    return;
  }

  socket = new WebSocket(url);
  connectionStatus.textContent = "Connecting";

  socket.addEventListener("open", () => {
    connectionStatus.textContent = "Online";
    send({
      type: "JOIN_ROOM",
      requestId: requestId(),
      payload: {
        playerName: playerNameInput.value.trim() || "Player",
        character
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
    cardDefinitions = message.payload.cardDefinitions;
    races = message.payload.races ?? {};
    raceCatalogLoaded = Object.keys(races).length > 0;
    raceCatalogStatus = raceCatalogLoaded
      ? `Room catalog ${message.payload.cardCatalogVersion} · ${Object.keys(races).length} races.`
      : `Room catalog ${message.payload.cardCatalogVersion} has no race data.`;
  }

  addLog(message);
  render();
}

function render(): void {
  const isOnline = socket?.readyState === WebSocket.OPEN;
  renderCharacterBuilder();
  readyButton.disabled = !isOnline || localState?.status === "PLAYING";
  drawButton.disabled = !canTakeMainAction();
  endButton.disabled = !canTakeMainAction();

  if (!localState) {
    playersEl.innerHTML = `<p class="muted">No players</p>`;
    gameStatusEl.textContent = "WAITING";
    turnLabel.textContent = "Turn 0";
    currentPlayerEl.textContent = "Current: none";
    pileControlsEl.innerHTML = "";
    drawPreviewEl.innerHTML = "";
    handEl.innerHTML = `<div class="empty-card">Connect to a room</div>`;
    return;
  }

  gameStatusEl.textContent = localState.status === "PLAYING"
    ? `${localState.status} · ${localState.turnPhase}`
    : localState.status;
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
          <div>Team ${escapeHtml(player.teamId)}</div>
          <div>${escapeHtml(raceName(player.character.raceId))}</div>
          <div>HP ${player.hp}/${player.maxHp}</div>
          <div>CON ${player.character.abilityScores.constitution} (${formatModifier(player.character.abilityModifiers.constitution)})</div>
          <div>Energy ${player.energy}/${player.maxEnergy}</div>
          <div>Hand ${localState!.zones.handCounts[id] ?? 0} · Deck ${localState!.zones.deckCounts[id] ?? 0}</div>
          <div>暫存 ${localState!.zones.temporaryCounts[id] ?? 0} · 消耗 ${localState!.zones.exhaustCounts[id] ?? 0}</div>
        </div>
      `;
    })
    .join("");

  renderPileControls();
  renderDrawPreview();
  const hand = playerId ? localState.zones.hand[playerId] ?? [] : [];
  handEl.innerHTML =
    hand.length > 0
      ? hand.map((card) => renderCard(card)).join("")
      : `<div class="empty-card">Hand is empty</div>`;
}

function renderPileControls(): void {
  if (!localState || !playerId) {
    pileControlsEl.innerHTML = "";
    return;
  }

  const piles = [
    {
      key: "deck",
      label: "牌庫",
      count: localState.zones.deckCounts[playerId] ?? 0
    },
    {
      key: "temporary",
      label: "暫存牌堆",
      count: localState.zones.temporaryCounts[playerId] ?? 0
    },
    {
      key: "exhaust",
      label: "消耗牌堆",
      count: localState.zones.exhaustCounts[playerId] ?? 0
    }
  ];

  pileControlsEl.innerHTML = piles
    .map((pile) => `
      <button type="button" data-pile="${pile.key}">${pile.label}(${pile.count})</button>
    `)
    .join("");
}

function renderDrawPreview(): void {
  if (!localState || !playerId) {
    drawPreviewEl.innerHTML = "";
    return;
  }

  const preview = localState.zones.drawPreview[playerId] ?? [];
  drawPreviewEl.innerHTML = preview.length > 0
    ? `
      <div class="preview-label">預知</div>
      <div class="preview-cards">
        ${preview.map((card) => `<span>${escapeHtml(hydrateVisibleCard(card).name ?? card.cardId)}</span>`).join("")}
      </div>
    `
    : "";
}

function renderCharacterBuilder(): void {
  connectForm.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled =
    !tryCreateCharacter();

  if (Object.keys(races).length === 0) {
    raceOptionsEl.innerHTML = `<p class="muted">Race catalog is not available.</p>`;
    abilityControlsEl.innerHTML = `<p class="muted">Ability controls are unavailable until race data is available.</p>`;
    abilityPointsEl.textContent = "Locked";
    abilityPointsEl.className = "points-warn";
    characterSummaryEl.textContent = "Race data is required before joining a room.";
    catalogStatusEl.textContent = raceCatalogStatus;
    return;
  }

  if (!races[selectedRaceId]) {
    selectedRaceId = Object.keys(races)[0] ?? "human";
  }

  const race = races[selectedRaceId];
  const spent = calculateCreationPointSpend(abilityScores);
  const remaining = CREATION_POINT_BUDGET - spent;
  const modifiers = calculateAbilityModifiers(abilityScores);

  raceOptionsEl.innerHTML = Object.values(races)
    .map((candidate) => `
      <label class="race-option ${candidate.raceId === selectedRaceId ? "selected" : ""}">
        <input type="checkbox" name="race" value="${escapeHtml(candidate.raceId)}" ${candidate.raceId === selectedRaceId ? "checked" : ""} />
        <span>
          <strong>${escapeHtml(candidate.name)}</strong>
          <small>HP ${candidate.baseHp} · ${candidate.naturalArmorType} ${candidate.naturalArmorValue}</small>
        </span>
      </label>
    `)
    .join("");

  abilityControlsEl.innerHTML = ABILITY_KEYS.map((ability) => {
    const value = abilityScores[ability];
    const max = race?.creationMax[ability] ?? 15;
    return `
      <div class="ability-row">
        <div>
          <strong>${abilityLabel(ability)}</strong>
          <span>Max ${max} · Mod ${formatModifier(modifiers[ability])}</span>
        </div>
        <div class="stepper">
          <button type="button" data-ability="${ability}" data-delta="-1" ${value <= CREATION_ABILITY_MIN ? "disabled" : ""}>-</button>
          <input data-ability-input="${ability}" type="number" min="${CREATION_ABILITY_MIN}" max="${max}" value="${value}" />
          <button type="button" data-ability="${ability}" data-delta="1" ${value >= max || remaining <= 0 ? "disabled" : ""}>+</button>
        </div>
      </div>
    `;
  }).join("");

  abilityPointsEl.textContent = `${remaining} points`;
  abilityPointsEl.className = remaining === 0 ? "points-ok" : "points-warn";

  const character = tryCreateCharacter();
  characterSummaryEl.textContent = character
    ? `${race.name} · HP ${character.maxHp} · CON ${formatModifier(character.abilityModifiers.constitution)}`
    : "Spend all points within the selected race limits.";
  catalogStatusEl.textContent = raceCatalogStatus;
}

raceOptionsEl.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.name !== "race") {
    return;
  }

  selectedRaceId = target.value;
  clampAbilityScoresToSelectedRace();
  render();
});

abilityControlsEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  const ability = target.dataset.ability as AbilityKey | undefined;
  const delta = Number(target.dataset.delta);
  if (!ability || !Number.isInteger(delta)) {
    return;
  }

  setAbilityScore(ability, abilityScores[ability] + delta);
});

abilityControlsEl.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  const ability = target.dataset.abilityInput as AbilityKey | undefined;
  if (!ability) {
    return;
  }

  setAbilityScore(ability, Number(target.value));
});

function setAbilityScore(ability: AbilityKey, value: number): void {
  const race = races[selectedRaceId];
  const max = race?.creationMax[ability] ?? 15;
  const nextValue = Number.isInteger(value)
    ? Math.max(CREATION_ABILITY_MIN, Math.min(max, value))
    : abilityScores[ability];

  abilityScores = {
    ...abilityScores,
    [ability]: nextValue
  };
  render();
}

function clampAbilityScoresToSelectedRace(): void {
  const race = races[selectedRaceId];
  if (!race) {
    return;
  }

  abilityScores = {
    strength: Math.min(abilityScores.strength, race.creationMax.strength),
    dexterity: Math.min(abilityScores.dexterity, race.creationMax.dexterity),
    intelligence: Math.min(abilityScores.intelligence, race.creationMax.intelligence),
    wisdom: Math.min(abilityScores.wisdom, race.creationMax.wisdom),
    charisma: Math.min(abilityScores.charisma, race.creationMax.charisma),
    constitution: Math.min(abilityScores.constitution, race.creationMax.constitution)
  };
}

function readCharacterConfig() {
  const character = tryCreateCharacter();
  if (!character) {
    addLog({ type: "LOCAL_NOTICE", payload: { message: "Complete character ability allocation before joining." } });
    render();
    return null;
  }

  return {
    raceId: selectedRaceId,
    abilityScores
  };
}

function tryCreateCharacter() {
  try {
    return validateAndCreateCharacter({ raceId: selectedRaceId, abilityScores }, races);
  } catch {
    return null;
  }
}

async function refreshCatalogFromWorkerUrl(): Promise<void> {
  const rawUrl = workerUrlInput.value.trim() || defaultWorkerUrl();
  let wsUrl: URL;

  try {
    wsUrl = new URL(rawUrl);
  } catch {
    raceCatalogLoaded = false;
    raceCatalogLoading = false;
    raceCatalogStatus = "Worker URL is invalid. Using local default races.";
    render();
    return;
  }

  raceCatalogLoading = true;
  raceCatalogLoaded = false;
  raceCatalogStatus = "Loading race catalog...";
  render();

  try {
    const catalogUrl = new URL(wsUrl);
    catalogUrl.protocol = catalogUrl.protocol === "wss:" ? "https:" : "http:";
    catalogUrl.pathname = "/api/card-catalog";
    catalogUrl.search = "";

    const response = await fetch(catalogUrl);
    if (!response.ok) {
      raceCatalogLoaded = false;
      raceCatalogStatus = `Race catalog unavailable at ${catalogUrl.origin}/api/card-catalog. Using local default races.`;
      render();
      return;
    }

    const catalog = await response.json() as {
      source?: string;
      version?: string;
      raceCount?: number;
      races?: Record<string, RaceDefinition>;
    };
    if (catalog.races && Object.keys(catalog.races).length > 0) {
      races = catalog.races;
      raceCatalogLoaded = true;
      clampAbilityScoresToSelectedRace();
      const raceCount = Object.keys(catalog.races).length;
      const defaultRaceCount = Object.keys(DEFAULT_RACES).length;
      const syncHint = raceCount === defaultRaceCount
        ? " If external races were updated, run card catalog sync."
        : "";
      raceCatalogStatus = `Loaded ${raceCount} races from ${catalog.source ?? "catalog"} ${catalog.version ?? ""}.${syncHint}`;
    } else {
      raceCatalogLoaded = false;
      raceCatalogStatus = "Catalog response has no races. Using local default races.";
    }
  } catch {
    raceCatalogLoaded = false;
    raceCatalogStatus = "Race catalog request failed. Using local default races.";
  } finally {
    raceCatalogLoading = false;
  }

  render();
}

function renderCard(card: VisibleCardInstance): string {
  const visibleCard = hydrateVisibleCard(card);
  const targeting = getCardTargeting(visibleCard);
  const targetControl = renderTargetControl(visibleCard, targeting);
  const isPlayDisabled = !canTakeMainAction() || (requiresEffectTarget(visibleCard) && getPotentialTargetIds(targeting).length === 0);
  const isDiscardDisabled = !canDiscardFromHand();

  return `
    <article class="card">
      <div class="card-cost">${visibleCard.cost ?? 0}</div>
      <h3>${escapeHtml(visibleCard.name ?? visibleCard.cardId)}</h3>
      <p>${escapeHtml(visibleCard.description ?? "")}</p>
      <div class="card-meta">
        <span>${targetingLabel(targeting)}</span>
        ${visibleCard.consumable ? `<span>消耗</span>` : ""}
      </div>
      ${targetControl}
      <div class="card-actions">
        <button type="button" data-play="${visibleCard.instanceId}" ${isPlayDisabled ? "disabled" : ""}>Play</button>
        <button type="button" data-discard="${visibleCard.instanceId}" ${isDiscardDisabled ? "disabled" : ""}>Discard</button>
      </div>
    </article>
  `;
}

function hydrateVisibleCard(card: VisibleCardInstance): VisibleCardInstance {
  const definition = cardDefinitions[card.cardId];

  if (!definition) {
    return card;
  }

  return {
    ...card,
    name: card.name ?? definition.name,
    cost: card.cost ?? definition.cost,
    type: card.type ?? definition.type,
    description: card.description ?? definition.description,
    effect: card.effect ?? definition.effect,
    targeting: card.targeting ?? definition.targeting,
    consumable: card.consumable ?? definition.consumable
  };
}

pileControlsEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  const pileKey = target.dataset.pile;
  if (!pileKey) {
    return;
  }

  openPileDialog(pileKey);
});

function openPileDialog(pileKey: string): void {
  if (!localState || !playerId) {
    return;
  }

  const pile = getPileView(pileKey);
  if (!pile) {
    return;
  }

  pileDialogTitle.textContent = `${pile.label}(${pile.count})`;
  pileDialogBody.innerHTML = pile.cards.length > 0
    ? pile.cards.map((card) => renderPileCard(card)).join("")
    : `<p class="muted">No cards</p>`;
  pileDialog.showModal();
}

function getPileView(pileKey: string): { label: string; count: number; cards: VisibleCardInstance[] } | null {
  if (!localState || !playerId) {
    return null;
  }

  if (pileKey === "deck") {
    return {
      label: "牌庫",
      count: localState.zones.deckCounts[playerId] ?? 0,
      cards: localState.zones.deck[playerId] ?? []
    };
  }

  if (pileKey === "temporary") {
    return {
      label: "暫存牌堆",
      count: localState.zones.temporaryCounts[playerId] ?? 0,
      cards: localState.zones.temporary[playerId] ?? []
    };
  }

  if (pileKey === "exhaust") {
    return {
      label: "消耗牌堆",
      count: localState.zones.exhaustCounts[playerId] ?? 0,
      cards: localState.zones.exhaust[playerId] ?? []
    };
  }

  return null;
}

function renderPileCard(card: VisibleCardInstance): string {
  const visibleCard = hydrateVisibleCard(card);
  return `
    <div class="pile-card">
      <strong>${escapeHtml(visibleCard.name ?? visibleCard.cardId)}</strong>
      <span>${escapeHtml(visibleCard.type ?? "")} · Cost ${visibleCard.cost ?? 0}</span>
    </div>
  `;
}

function renderTargetControl(card: VisibleCardInstance, targeting: CardTargeting): string {
  if (targeting.selection === "GROUP") {
    const targetIds = getPotentialTargetIds(targeting);
    if (targetIds.length === 0) {
      return `<p class="muted card-target-empty">No valid target</p>`;
    }

    return `<p class="card-target-summary">Targets: ${targetIds.map((id) => escapeHtml(playerLabel(id))).join(", ")}</p>`;
  }

  if (!targeting.requiresTarget) {
    return "";
  }

  const options = getPotentialTargetIds(targeting);
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

function getPotentialTargetIds(targeting: CardTargeting): string[] {
  if (!localState || !playerId) {
    return [];
  }

  if (targeting.selection === "GROUP" || !targeting.requiresTarget) {
    return getAutomaticTargetIds(localState, playerId, targeting);
  }

  return getSelectableTargetIds(localState, playerId, targeting);
}

function canTakeMainAction(): boolean {
  return Boolean(
    socket?.readyState === WebSocket.OPEN &&
    localState?.status === "PLAYING" &&
    localState.currentPlayerId === playerId &&
    localState.turnPhase === "MAIN"
  );
}

function canDiscardFromHand(): boolean {
  return Boolean(
    socket?.readyState === WebSocket.OPEN &&
    localState?.status === "PLAYING" &&
    localState.currentPlayerId === playerId &&
    (localState.turnPhase === "MAIN" || localState.pendingDiscard?.playerId === playerId)
  );
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

  const card = (localState.zones.hand[playerId] ?? []).find((candidate) => candidate.instanceId === cardInstanceId);
  return card ? hydrateVisibleCard(card) : undefined;
}

function selectedTargetForCard(cardInstanceId: string): string | undefined {
  const select = Array.from(handEl.querySelectorAll<HTMLSelectElement>("select[data-target-for]"))
    .find((candidate) => candidate.dataset.targetFor === cardInstanceId);
  return select?.value || undefined;
}

function requiresEffectTarget(card: VisibleCardInstance): boolean {
  return card.effect?.type === "DAMAGE" || card.effect?.type === "HEAL";
}

function playerLabel(id: string): string {
  const player = localState?.players[id];
  return player ? `${player.name} (${id})` : id;
}

function raceName(raceId: string): string {
  return races[raceId]?.name ?? raceId;
}

function abilityLabel(ability: AbilityKey): string {
  return {
    strength: "力量",
    dexterity: "敏捷",
    intelligence: "智力",
    wisdom: "感知",
    charisma: "魅力",
    constitution: "體質"
  }[ability];
}

function formatModifier(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
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
