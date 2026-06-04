import { CARD_DEFINITIONS } from "../shared/rules/cardDefinitions.js";
import { resolveCardEffect } from "../shared/rules/cardEffects.js";
import type { CardDefinition, CardInstance } from "../shared/types/card.js";
import type { GameState, PlayerState } from "../shared/types/game.js";
import type {
  CardDrawnEvent,
  GameEvent,
  GameStateSyncEvent,
  JoinAcceptedEvent
} from "../shared/types/network.js";
import { CommandError } from "./CommandError.js";
import { DeckManager } from "./DeckManager.js";
import { SnapshotService } from "./SnapshotService.js";

const INITIAL_HP = 20;
const INITIAL_HAND_SIZE = 3;
const MAX_ENERGY_CAP = 10;

export class GameStateStore {
  readonly cardDefinitions: Record<string, CardDefinition>;

  private readonly deckManager = new DeckManager();
  private readonly snapshotService: SnapshotService;
  private readonly state: GameState;
  private nextPlayerNumber = 1;

  constructor(roomId = `room_${Math.random().toString(36).slice(2, 8)}`) {
    this.cardDefinitions = CARD_DEFINITIONS;
    this.snapshotService = new SnapshotService(this.cardDefinitions);
    this.state = {
      roomId,
      status: "WAITING",
      turn: 0,
      currentPlayerId: null,
      playerOrder: [],
      players: {},
      zones: {
        deck: {},
        hand: {},
        board: [],
        graveyard: [],
        exile: []
      },
      eventSeq: 0,
      winnerId: null
    };
  }

  getState(): GameState {
    return this.state;
  }

  addPlayer(playerName: string): {
    player: PlayerState;
    privateEvents: JoinAcceptedEvent[];
    broadcastEvents: GameEvent[];
  } {
    if (this.state.status !== "WAITING") {
      throw new CommandError("GAME_ALREADY_STARTED", "Game already started.");
    }

    const playerId = `p${this.nextPlayerNumber++}`;
    const player: PlayerState = {
      playerId,
      name: playerName.trim() || playerId,
      hp: INITIAL_HP,
      energy: 0,
      maxEnergy: 0,
      connected: true,
      ready: false
    };

    this.state.players[playerId] = player;
    this.state.playerOrder.push(playerId);
    this.state.zones.deck[playerId] = [];
    this.state.zones.hand[playerId] = [];

    return {
      player,
      privateEvents: [
        {
          type: "JOIN_ACCEPTED",
          seq: this.nextSeq(),
          payload: {
            playerId,
            roomId: this.state.roomId
          }
        }
      ],
      broadcastEvents: [
        {
          type: "PLAYER_JOINED",
          seq: this.nextSeq(),
          payload: {
            player
          }
        }
      ]
    };
  }

  markPlayerDisconnected(playerId: string): void {
    const player = this.state.players[playerId];
    if (player) {
      player.connected = false;
    }
  }

  markPlayerReady(playerId: string): GameEvent[] {
    this.assertKnownPlayer(playerId);

    if (this.state.status !== "WAITING") {
      throw new CommandError("GAME_ALREADY_STARTED", "Ready can only be changed before the game starts.");
    }

    this.state.players[playerId].ready = true;

    const events: GameEvent[] = [
      {
        type: "PLAYER_READY_CHANGED",
        seq: this.nextSeq(),
        payload: {
          playerId,
          ready: true
        }
      }
    ];

    if (this.canStartGame()) {
      events.push(...this.startGame());
    }

    return events;
  }

  drawCard(playerId: string): GameEvent[] {
    this.assertPlaying();
    this.assertCurrentPlayer(playerId);
    return this.drawCards(playerId, 1);
  }

  playCard(playerId: string, cardInstanceId: string, targetId?: string): GameEvent[] {
    this.assertPlaying();
    this.assertCurrentPlayer(playerId);

    const { card, index } = this.findCardInHand(playerId, cardInstanceId);
    const definition = this.getCardDefinition(card.cardId);
    const player = this.state.players[playerId];

    if (player.energy < definition.cost) {
      throw new CommandError("NOT_ENOUGH_ENERGY", `${definition.name} costs ${definition.cost} energy.`);
    }

    this.validateTarget(definition, playerId, targetId);
    player.energy -= definition.cost;

    this.state.zones.hand[playerId].splice(index, 1);
    card.zone = "GRAVEYARD";
    this.state.zones.graveyard.push(card);

    const events: GameEvent[] = [
      {
        type: "CARD_PLAYED",
        seq: this.nextSeq(),
        payload: {
          playerId,
          cardInstanceId,
          cardId: card.cardId,
          targetId
        }
      }
    ];

    events.push(
      ...resolveCardEffect({
        state: this.state,
        sourceCard: card,
        sourceDefinition: definition,
        playerId,
        targetId,
        nextSeq: () => this.nextSeq(),
        drawCards: (drawingPlayerId, count) => this.drawCards(drawingPlayerId, count)
      })
    );

    return events;
  }

  discardCard(playerId: string, cardInstanceId: string): GameEvent[] {
    this.assertPlaying();
    this.assertCurrentPlayer(playerId);

    const { card, index } = this.findCardInHand(playerId, cardInstanceId);
    this.state.zones.hand[playerId].splice(index, 1);
    card.zone = "GRAVEYARD";
    this.state.zones.graveyard.push(card);

    return [
      {
        type: "CARD_DISCARDED",
        seq: this.nextSeq(),
        payload: {
          playerId,
          cardInstanceId,
          cardId: card.cardId
        }
      }
    ];
  }

  endTurn(playerId: string): GameEvent[] {
    this.assertPlaying();
    this.assertCurrentPlayer(playerId);

    const events: GameEvent[] = [
      {
        type: "TURN_ENDED",
        seq: this.nextSeq(),
        payload: {
          playerId,
          turn: this.state.turn
        }
      }
    ];

    const currentIndex = this.state.playerOrder.indexOf(playerId);
    const nextIndex = (currentIndex + 1) % this.state.playerOrder.length;
    const nextPlayerId = this.state.playerOrder[nextIndex];

    this.state.turn += 1;
    this.state.currentPlayerId = nextPlayerId;
    events.push(...this.startTurn(nextPlayerId));
    return events;
  }

  createSnapshotEvent(playerId: string): GameStateSyncEvent {
    return {
      type: "GAME_STATE_SYNC",
      seq: this.state.eventSeq,
      payload: {
        state: this.snapshotService.createVisibleState(this.state, playerId),
        cardDefinitions: this.cardDefinitions
      }
    };
  }

  createCommandRejectedEvent(error: CommandError, requestId?: string): GameEvent {
    return {
      type: "COMMAND_REJECTED",
      seq: this.nextSeq(),
      payload: {
        requestId,
        code: error.code,
        message: error.message
      }
    };
  }

  private startGame(): GameEvent[] {
    this.state.status = "PLAYING";
    this.state.turn = 1;
    this.state.winnerId = null;

    for (const playerId of this.state.playerOrder) {
      const player = this.state.players[playerId];
      player.hp = INITIAL_HP;
      player.energy = 0;
      player.maxEnergy = 0;
      this.state.zones.deck[playerId] = this.deckManager.shuffle(
        this.deckManager.buildStarterDeck(playerId)
      );
      this.state.zones.hand[playerId] = [];
    }

    const firstPlayerId = this.state.playerOrder[0];
    this.state.currentPlayerId = firstPlayerId;

    const events: GameEvent[] = [
      {
        type: "GAME_STARTED",
        seq: this.nextSeq(),
        payload: {
          firstPlayerId
        }
      }
    ];

    for (const playerId of this.state.playerOrder) {
      events.push(...this.drawCards(playerId, INITIAL_HAND_SIZE));
    }

    events.push(...this.startTurn(firstPlayerId));
    return events;
  }

  private startTurn(playerId: string): GameEvent[] {
    const player = this.state.players[playerId];
    player.maxEnergy = Math.min(MAX_ENERGY_CAP, player.maxEnergy + 1);
    player.energy = player.maxEnergy;

    return [
      {
        type: "TURN_STARTED",
        seq: this.nextSeq(),
        payload: {
          playerId,
          turn: this.state.turn
        }
      },
      ...this.drawCards(playerId, 1)
    ];
  }

  private drawCards(playerId: string, count: number): CardDrawnEvent[] {
    this.assertKnownPlayer(playerId);
    const events: CardDrawnEvent[] = [];

    for (let drawIndex = 0; drawIndex < count; drawIndex += 1) {
      const card = this.state.zones.deck[playerId]?.pop();
      if (!card) {
        break;
      }

      card.zone = "HAND";
      this.state.zones.hand[playerId].push(card);
      events.push({
        type: "CARD_DRAWN",
        seq: this.nextSeq(),
        payload: {
          playerId,
          cardInstanceId: card.instanceId,
          privateCardData: {
            cardId: card.cardId
          }
        }
      });
    }

    return events;
  }

  private canStartGame(): boolean {
    return (
      this.state.playerOrder.length >= 2 &&
      this.state.playerOrder.every((playerId) => this.state.players[playerId].ready)
    );
  }

  private findCardInHand(playerId: string, cardInstanceId: string): { card: CardInstance; index: number } {
    const hand = this.state.zones.hand[playerId] ?? [];
    const index = hand.findIndex((candidate) => candidate.instanceId === cardInstanceId);

    if (index === -1) {
      throw new CommandError("CARD_NOT_IN_HAND", `Card ${cardInstanceId} is not in ${playerId}'s hand.`);
    }

    return {
      card: hand[index],
      index
    };
  }

  private getCardDefinition(cardId: string): CardDefinition {
    const definition = this.cardDefinitions[cardId];
    if (!definition) {
      throw new CommandError("UNKNOWN_CARD", `Card definition ${cardId} does not exist.`);
    }

    return definition;
  }

  private validateTarget(definition: CardDefinition, playerId: string, targetId?: string): void {
    if (!targetId) {
      return;
    }

    if (!this.state.players[targetId]) {
      throw new CommandError("INVALID_TARGET", `Target ${targetId} does not exist.`);
    }

    if (definition.effect.type === "DAMAGE" && targetId === playerId) {
      throw new CommandError("INVALID_TARGET", "Damage cards must target an opponent.");
    }
  }

  private assertPlaying(): void {
    if (this.state.status !== "PLAYING") {
      throw new CommandError("GAME_NOT_PLAYING", "The game is not currently playing.");
    }
  }

  private assertCurrentPlayer(playerId: string): void {
    if (this.state.currentPlayerId !== playerId) {
      throw new CommandError("NOT_YOUR_TURN", "Only the current player can perform this command.");
    }
  }

  private assertKnownPlayer(playerId: string): void {
    if (!this.state.players[playerId]) {
      throw new CommandError("UNKNOWN_PLAYER", `Player ${playerId} does not exist.`);
    }
  }

  private nextSeq(): number {
    this.state.eventSeq += 1;
    return this.state.eventSeq;
  }
}
