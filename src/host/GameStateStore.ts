import { DEFAULT_CARD_CATALOG } from "../shared/rules/cardDefinitions.js";
import { DEFAULT_RACES, validateAndCreateCharacter } from "../shared/rules/characterRules.js";
import { resolveCardEffect, type EffectEvent } from "../shared/rules/cardEffects.js";
import {
  getAutomaticTargetIds,
  getCardTargeting,
  isPlayerTargetAllowed
} from "../shared/rules/cardTargets.js";
import type { CardActionTag, CardDefinition, CardInstance, CardZone } from "../shared/types/card.js";
import type { CardCatalog, CardTransformRevertTiming, CardTransformRule } from "../shared/types/cardCatalog.js";
import type { CharacterConfig, CharacterState, RaceDefinition } from "../shared/types/character.js";
import type { GameState, PlayerState } from "../shared/types/game.js";
import type {
  CardConsumedEvent,
  CardDrawnEvent,
  CardActionTriggeredEvent,
  CardTransformedEvent,
  DeckRecycledEvent,
  GameEvent,
  GameStateSyncEvent,
  HpPaidEvent,
  JoinAcceptedEvent
} from "../shared/types/network.js";
import { CommandError } from "./CommandError.js";
import { DeckManager } from "./DeckManager.js";
import { SnapshotService } from "./SnapshotService.js";

const INITIAL_HAND_SIZE = 3;
const BASE_MAX_ENERGY = 3;
const BASE_TURN_DRAW_COUNT = 3;

type PendingCardRevert = {
  ruleId: string;
  playerId: string;
  sourceId: string;
  cardInstanceId: string;
  sourceCardId: string;
  targetCardId: string;
  revertTiming: Exclude<CardTransformRevertTiming, "NEVER">;
};

type PreparedActionTriggerContext = {
  sourcePlayerId: string;
  sourceDefinition: CardDefinition;
  targetIds: string[];
  effectEvents: EffectEvent[];
};

type PlayResourcePayment = {
  consumedCards: CardInstance[];
};

export class GameStateStore {
  readonly cardDefinitions: Record<string, CardDefinition>;
  readonly cardCatalogVersion: string;
  readonly races: Record<string, RaceDefinition>;

  private readonly transformRules: CardTransformRule[];
  private readonly deckManager: DeckManager;
  private readonly snapshotService: SnapshotService;
  private readonly state: GameState;
  private pendingCardReverts: PendingCardRevert[] = [];
  private nextPlayerNumber = 1;

  constructor(
    roomId = `room_${Math.random().toString(36).slice(2, 8)}`,
    cardCatalog: CardCatalog = DEFAULT_CARD_CATALOG
  ) {
    this.cardDefinitions = cardCatalog.cardDefinitions;
    this.cardCatalogVersion = cardCatalog.version;
    this.races = cardCatalog.races ?? DEFAULT_RACES;
    this.transformRules = cardCatalog.transformRules ?? [];
    this.deckManager = new DeckManager(cardCatalog.starterDeckCardIds);
    this.snapshotService = new SnapshotService(this.cardDefinitions);
    this.state = {
      roomId,
      status: "WAITING",
      turn: 0,
      turnPhase: "WAITING",
      pendingDiscard: null,
      currentPlayerId: null,
      playerOrder: [],
      players: {},
      zones: {
        deck: {},
        hand: {},
        prepared: {},
        temporary: {},
        exhaust: {},
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

  addPlayer(playerName: string, clientSessionId: string): {
    player: PlayerState;
    privateEvents: JoinAcceptedEvent[];
    broadcastEvents: GameEvent[];
  } {
    const normalizedSessionId = clientSessionId.trim();
    const existingPlayer = this.findPlayerBySession(normalizedSessionId);
    if (existingPlayer) {
      existingPlayer.connected = true;
      existingPlayer.name = playerName.trim() || existingPlayer.playerId;
      return {
        player: existingPlayer,
        privateEvents: [
          {
            type: "JOIN_ACCEPTED",
            seq: this.nextSeq(),
            payload: {
              playerId: existingPlayer.playerId,
              roomId: this.state.roomId
            }
          }
        ],
        broadcastEvents: []
      };
    }

    if (this.state.status !== "WAITING") {
      throw new CommandError("GAME_ALREADY_STARTED", "Game already started.");
    }

    const playerId = `p${this.nextPlayerNumber++}`;
    const player: PlayerState = {
      playerId,
      name: playerName.trim() || playerId,
      clientSessionId: normalizedSessionId,
      teamId: getDefaultTeamId(this.state.playerOrder.length),
      character: null,
      hp: 0,
      maxHp: 0,
      energy: 0,
      maxEnergy: BASE_MAX_ENERGY,
      drawPerTurn: BASE_TURN_DRAW_COUNT,
      connected: true,
      ready: false
    };

    this.state.players[playerId] = player;
    this.state.playerOrder.push(playerId);
    this.state.zones.deck[playerId] = [];
    this.state.zones.hand[playerId] = [];
    this.state.zones.prepared[playerId] = [];
    this.state.zones.temporary[playerId] = [];
    this.state.zones.exhaust[playerId] = [];

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

  setPlayerCharacter(playerId: string, characterConfig: CharacterConfig): GameEvent[] {
    this.assertKnownPlayer(playerId);

    if (this.state.status !== "WAITING") {
      throw new CommandError("GAME_ALREADY_STARTED", "Character can only be changed before the game starts.");
    }

    const player = this.state.players[playerId];
    if (player.ready) {
      throw new CommandError("PLAYER_READY_LOCKED", "Cancel ready before changing character.");
    }

    const character = this.createCharacter(characterConfig);
    player.character = character;
    player.maxHp = character.maxHp;
    player.hp = character.maxHp;

    return [
      {
        type: "PLAYER_CHARACTER_UPDATED",
        seq: this.nextSeq(),
        payload: {
          player
        }
      }
    ];
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

    const player = this.state.players[playerId];
    if (!player.character) {
      throw new CommandError("CHARACTER_REQUIRED", "Set a valid character before readying.");
    }

    player.ready = true;

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

  cancelPlayerReady(playerId: string): GameEvent[] {
    this.assertKnownPlayer(playerId);

    if (this.state.status !== "WAITING") {
      throw new CommandError("GAME_ALREADY_STARTED", "Ready can only be changed before the game starts.");
    }

    this.state.players[playerId].ready = false;

    return [
      {
        type: "PLAYER_READY_CHANGED",
        seq: this.nextSeq(),
        payload: {
          playerId,
          ready: false
        }
      }
    ];
  }

  drawCard(playerId: string): GameEvent[] {
    this.assertPlaying();
    this.assertCurrentPlayer(playerId);
    this.assertMainPhase();
    return this.drawCards(playerId, 1);
  }

  playCard(
    playerId: string,
    cardInstanceId: string,
    targetId?: string,
    resourceCardInstanceIds: string[] = []
  ): GameEvent[] {
    this.assertPlaying();
    this.assertCurrentPlayer(playerId);
    this.assertMainPhase();

    const { card } = this.findCardInHand(playerId, cardInstanceId);
    const definition = this.getCardDefinition(card.cardId);
    const preparedActionTag = this.getPlayToPreparedActionTag(definition);
    const resourcePayment = this.resolvePlayResourcePayment(
      playerId,
      cardInstanceId,
      definition,
      resourceCardInstanceIds
    );
    const player = this.state.players[playerId];

    this.assertCanPayCardCosts(player, definition);

    if (preparedActionTag) {
      const events = this.payAdditionalCardCosts(playerId, card, definition, resourcePayment);
      player.energy -= definition.cost;
      this.removeCardFromHand(playerId, cardInstanceId);
      const destinationZone = this.moveCardToPrepared(card);

      events.push({
        type: "CARD_PLAYED",
        seq: this.nextSeq(),
        payload: {
          playerId,
          cardInstanceId,
          cardId: card.cardId,
          destinationZone
        }
      });

      events.push(...this.revertPendingCardTransformForLeavingHand(playerId, card));
      return events;
    }

    const resolvedTargetIds = this.resolveTargetIds(definition, playerId, targetId);
    this.assertEffectTargetsResolved(definition, resolvedTargetIds);
    const events = this.payAdditionalCardCosts(playerId, card, definition, resourcePayment);
    player.energy -= definition.cost;

    this.removeCardFromHand(playerId, cardInstanceId);
    const destinationZone = this.movePlayedCardToDestination(card, definition);

    events.push({
      type: "CARD_PLAYED",
      seq: this.nextSeq(),
      payload: {
        playerId,
        cardInstanceId,
        cardId: card.cardId,
        destinationZone,
        targetId: resolvedTargetIds[0],
        targetIds: resolvedTargetIds
      }
    });

    const effectEvents = resolveCardEffect({
      state: this.state,
      sourceCard: card,
      sourceDefinition: definition,
      playerId,
      targetIds: resolvedTargetIds,
      nextSeq: () => this.nextSeq(),
      drawCards: (drawingPlayerId, count) => this.drawCards(drawingPlayerId, count)
    });
    events.push(...effectEvents);
    if (this.state.status !== "ENDED") {
      events.push(
        ...this.resolvePreparedActionTriggers({
          sourcePlayerId: playerId,
          sourceDefinition: definition,
          targetIds: resolvedTargetIds,
          effectEvents
        })
      );
    }
    events.push(...this.applyTransformRules(playerId, card));
    events.push(...this.revertPendingCardTransformForLeavingHand(playerId, card));

    return events;
  }

  discardCard(playerId: string, cardInstanceId: string, targetId?: string): GameEvent[] {
    this.assertPlaying();
    this.assertCurrentPlayer(playerId);
    this.assertDiscardAllowed(playerId);

    const { card, index } = this.findCardInHand(playerId, cardInstanceId);
    const definition = this.getCardDefinition(card.cardId);
    const actionTag = this.getTriggeredDiscardActionTag(definition);
    const actionTargetIds = actionTag
      ? this.resolveActionTargetIds(definition, playerId, targetId)
      : [];

    this.state.zones.hand[playerId].splice(index, 1);
    const revertEvents = this.revertPendingCardTransformForLeavingHand(playerId, card);
    const destinationZone = this.moveCardToTemporary(card);

    const events: GameEvent[] = [
      ...revertEvents,
      {
        type: "CARD_DISCARDED",
        seq: this.nextSeq(),
        payload: {
          playerId,
          cardInstanceId,
          cardId: card.cardId,
          destinationZone
        }
      },
      ...(actionTag
        ? this.resolveTriggeredActionEvents(playerId, card, definition, actionTag, actionTargetIds)
        : [])
    ];

    if (
      this.state.status !== "ENDED" &&
      this.state.turnPhase === "DISCARD" &&
      this.hasCompletedPendingDiscard(playerId)
    ) {
      events.push(...this.completeTurn(playerId));
    }

    return events;
  }

  endTurn(playerId: string): GameEvent[] {
    this.assertPlaying();
    this.assertCurrentPlayer(playerId);
    this.assertMainPhase();
    return this.startDiscardOrCompleteTurn(playerId);
  }

  createSnapshotEvent(playerId: string): GameStateSyncEvent {
    return {
      type: "GAME_STATE_SYNC",
      seq: this.state.eventSeq,
      payload: {
        state: this.snapshotService.createVisibleState(this.state, playerId),
        cardDefinitions: this.cardDefinitions,
        races: this.races,
        cardCatalogVersion: this.cardCatalogVersion
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
    this.state.turnPhase = "MAIN";
    this.state.pendingDiscard = null;
    this.state.winnerId = null;
    this.pendingCardReverts = [];

    for (const playerId of this.state.playerOrder) {
      const player = this.state.players[playerId];
      const character = this.assertPlayerCharacter(player);
      player.character = character;
      player.maxHp = character.maxHp;
      player.hp = character.maxHp;
      player.energy = 0;
      player.maxEnergy = BASE_MAX_ENERGY;
      player.drawPerTurn = BASE_TURN_DRAW_COUNT;
      this.state.zones.deck[playerId] = this.deckManager.shuffle(
        this.deckManager.buildStarterDeck(playerId)
      );
      this.state.zones.hand[playerId] = [];
      this.state.zones.prepared[playerId] = [];
      this.state.zones.temporary[playerId] = [];
      this.state.zones.exhaust[playerId] = [];
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
    const retainedEnergy = this.resolveRetainedEnergy(player);
    player.energy = player.maxEnergy + retainedEnergy;
    this.state.turnPhase = "MAIN";
    this.state.pendingDiscard = null;

    const events: GameEvent[] = [
      {
        type: "TURN_STARTED",
        seq: this.nextSeq(),
        payload: {
          playerId,
          turn: this.state.turn
        }
      }
    ];

    events.push(...this.resolveTurnStartPreparedActions(playerId));

    if (this.state.status !== "ENDED") {
      events.push(...this.drawCards(playerId, this.resolveTurnDrawCount(player)));
    }

    return events;
  }

  private drawCards(playerId: string, count: number): Array<CardDrawnEvent | DeckRecycledEvent> {
    this.assertKnownPlayer(playerId);
    const events: Array<CardDrawnEvent | DeckRecycledEvent> = [];

    for (let drawIndex = 0; drawIndex < count; drawIndex += 1) {
      if ((this.state.zones.deck[playerId]?.length ?? 0) === 0) {
        events.push(...this.recycleTemporaryPileIntoDeck(playerId));
      }

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

  private recycleTemporaryPileIntoDeck(playerId: string): DeckRecycledEvent[] {
    const temporaryPile = this.state.zones.temporary[playerId] ?? [];
    if (temporaryPile.length === 0) {
      return [];
    }

    const recycledCards = this.deckManager.shuffle(temporaryPile.splice(0));
    for (const card of recycledCards) {
      card.zone = "DECK";
    }
    this.state.zones.deck[playerId] = [
      ...(this.state.zones.deck[playerId] ?? []),
      ...recycledCards
    ];

    return [
      {
        type: "DECK_RECYCLED",
        seq: this.nextSeq(),
        payload: {
          playerId,
          recycledCount: recycledCards.length
        }
      }
    ];
  }

  private startDiscardOrCompleteTurn(playerId: string): GameEvent[] {
    const retainCount = this.resolveHandRetainCount(this.state.players[playerId]);
    const handCount = this.state.zones.hand[playerId]?.length ?? 0;

    if (handCount > retainCount) {
      this.state.turnPhase = "DISCARD";
      this.state.pendingDiscard = {
        playerId,
        retainCount
      };

      return [
        {
          type: "DISCARD_PHASE_STARTED",
          seq: this.nextSeq(),
          payload: {
            playerId,
            retainCount,
            discardCount: handCount - retainCount
          }
        }
      ];
    }

    const events = this.discardHandDownToRetainCount(playerId, retainCount);
    if (this.state.status !== "ENDED") {
      events.push(...this.completeTurn(playerId));
    }
    return events;
  }

  private discardHandDownToRetainCount(playerId: string, retainCount: number): GameEvent[] {
    const hand = this.state.zones.hand[playerId] ?? [];
    const events: GameEvent[] = [];

    while (hand.length > retainCount) {
      const card = hand.shift();
      if (!card) {
        break;
      }

      const definition = this.getCardDefinition(card.cardId);
      const actionTag = this.getTriggeredDiscardActionTag(definition);
      const actionTargetIds = actionTag
        ? this.resolveAutomaticActionTargetIds(definition, playerId)
        : null;

      events.push(...this.revertPendingCardTransformForLeavingHand(playerId, card));
      const destinationZone = this.moveCardToTemporary(card);
      events.push({
        type: "CARD_DISCARDED",
        seq: this.nextSeq(),
        payload: {
          playerId,
          cardInstanceId: card.instanceId,
          cardId: card.cardId,
          destinationZone
        }
      });

      if (actionTag && actionTargetIds) {
        events.push(...this.resolveTriggeredActionEvents(playerId, card, definition, actionTag, actionTargetIds));
      }

      if (this.state.status === "ENDED") {
        break;
      }
    }

    return events;
  }

  private completeTurn(playerId: string): GameEvent[] {
    this.state.turnPhase = "MAIN";
    this.state.pendingDiscard = null;

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
    events.push(...this.revertPendingCardTransforms(playerId, "TURN_END"));

    const currentIndex = this.state.playerOrder.indexOf(playerId);
    const nextIndex = (currentIndex + 1) % this.state.playerOrder.length;
    const nextPlayerId = this.state.playerOrder[nextIndex];

    this.state.turn += 1;
    this.state.currentPlayerId = nextPlayerId;
    events.push(...this.startTurn(nextPlayerId));
    return events;
  }

  private hasCompletedPendingDiscard(playerId: string): boolean {
    const pendingDiscard = this.state.pendingDiscard;
    if (!pendingDiscard || pendingDiscard.playerId !== playerId) {
      return false;
    }

    return (this.state.zones.hand[playerId]?.length ?? 0) <= pendingDiscard.retainCount;
  }

  private getTriggeredDiscardActionTag(definition: CardDefinition): CardActionTag | null {
    return definition.actionTags?.find(
      (tag) => tag.type === "BONUS_ACTION" && tag.trigger === "DISCARD"
    ) ?? null;
  }

  private getPlayToPreparedActionTag(definition: CardDefinition): CardActionTag | null {
    return definition.actionTags?.find((tag) =>
      tag.type === "REACTION_ACTION" ||
      tag.type === "COUNTER_ACTION"
    ) ?? (definition.consumable ? this.getReadyActionTag(definition) : null);
  }

  private getPreparedActionTag(definition: CardDefinition): CardActionTag | null {
    return definition.actionTags?.find((tag) =>
      tag.type === "REACTION_ACTION" ||
      tag.type === "COUNTER_ACTION" ||
      tag.type === "READY_ACTION"
    ) ?? null;
  }

  private getReadyActionTag(definition: CardDefinition): CardActionTag | null {
    return definition.actionTags?.find((tag) => tag.type === "READY_ACTION") ?? null;
  }

  private resolvePreparedActionTriggers(context: PreparedActionTriggerContext): GameEvent[] {
    const events: GameEvent[] = [];

    for (const ownerId of this.state.playerOrder) {
      if (ownerId === context.sourcePlayerId) {
        continue;
      }

      const preparedCards = [...(this.state.zones.prepared[ownerId] ?? [])];
      for (const card of preparedCards) {
        const definition = this.getCardDefinition(card.cardId);
        const actionTag = this.getPreparedActionTag(definition);
        const trigger = actionTag ? this.resolvePreparedTrigger(actionTag, ownerId, context) : null;
        if (!actionTag || !trigger) {
          continue;
        }

        events.push(
          ...this.resolvePreparedActionCard(ownerId, card, definition, actionTag, trigger, context.sourcePlayerId)
        );

        if (this.state.status === "ENDED") {
          return events;
        }
      }
    }

    return events;
  }

  private resolveTurnStartPreparedActions(playerId: string): GameEvent[] {
    const events: GameEvent[] = [];
    const preparedCards = [...(this.state.zones.prepared[playerId] ?? [])];

    for (const card of preparedCards) {
      const definition = this.getCardDefinition(card.cardId);
      const actionTag = this.getPreparedActionTag(definition);
      if (!actionTag || actionTag.type !== "READY_ACTION") {
        continue;
      }

      events.push(
        ...this.resolvePreparedActionCard(playerId, card, definition, actionTag, "TURN_STARTED", playerId)
      );

      if (this.state.status === "ENDED") {
        break;
      }
    }

    return events;
  }

  private resolvePreparedTrigger(
    actionTag: CardActionTag,
    ownerId: string,
    context: PreparedActionTriggerContext
  ): CardActionTag["trigger"] | null {
    if (actionTag.type === "REACTION_ACTION") {
      const wasDamaged = context.effectEvents.some((event) =>
        event.type === "DAMAGE_APPLIED" && event.payload.targetId === ownerId
      );
      return wasDamaged ? "DAMAGE_TARGETED" : null;
    }

    if (actionTag.type === "COUNTER_ACTION") {
      if (!context.targetIds.includes(ownerId)) {
        return null;
      }

      if (context.sourceDefinition.type === "SKILL") {
        return "SKILL_TARGETED";
      }

      if (context.sourceDefinition.type === "MAGE") {
        return "MAGE_TARGETED";
      }
    }

    return null;
  }

  private resolvePreparedActionCard(
    playerId: string,
    card: CardInstance,
    definition: CardDefinition,
    actionTag: CardActionTag,
    trigger: CardActionTag["trigger"],
    defaultTargetId: string
  ): GameEvent[] {
    this.removeCardFromPrepared(playerId, card.instanceId);
    const destinationZone = this.movePlayedCardToDestination(card, definition);
    const targetIds = this.resolvePreparedActionTargetIds(actionTag, playerId, defaultTargetId);
    const events: GameEvent[] = [
      {
        type: "CARD_ACTION_TRIGGERED",
        seq: this.nextSeq(),
        payload: {
          playerId,
          cardInstanceId: card.instanceId,
          cardId: card.cardId,
          actionTag: actionTag.type,
          trigger,
          destinationZone,
          targetId: targetIds[0],
          targetIds
        }
      }
    ];

    events.push(
      ...resolveCardEffect({
        state: this.state,
        sourceCard: card,
        sourceDefinition: definition,
        playerId,
        targetIds,
        nextSeq: () => this.nextSeq(),
        drawCards: (drawingPlayerId, count) => this.drawCards(drawingPlayerId, count)
      })
    );
    events.push(...this.applyTransformRules(playerId, card));
    return events;
  }

  private resolvePreparedActionTargetIds(
    actionTag: CardActionTag,
    playerId: string,
    defaultTargetId: string
  ): string[] {
    if (actionTag.type === "READY_ACTION") {
      return [playerId];
    }

    return [defaultTargetId];
  }

  private removeCardFromPrepared(playerId: string, cardInstanceId: string): void {
    const prepared = this.state.zones.prepared[playerId] ?? [];
    const index = prepared.findIndex((candidate) => candidate.instanceId === cardInstanceId);
    if (index !== -1) {
      prepared.splice(index, 1);
    }
  }

  private resolvePlayResourcePayment(
    playerId: string,
    sourceCardInstanceId: string,
    definition: CardDefinition,
    resourceCardInstanceIds: string[]
  ): PlayResourcePayment {
    const consumeCardCount = definition.resourceCosts?.consumeCardCount ?? 0;

    if (consumeCardCount === 0) {
      if (resourceCardInstanceIds.length > 0) {
        throw new CommandError(
          "INVALID_RESOURCE_COST",
          `${definition.name} does not require consumed card resources.`
        );
      }

      return {
        consumedCards: []
      };
    }

    if (resourceCardInstanceIds.length !== consumeCardCount) {
      throw new CommandError(
        "INVALID_RESOURCE_COST",
        `${definition.name} requires ${consumeCardCount} consumed card resource(s).`
      );
    }

    const uniqueCardIds = new Set(resourceCardInstanceIds);
    if (uniqueCardIds.size !== resourceCardInstanceIds.length) {
      throw new CommandError("INVALID_RESOURCE_COST", "Consumed card resources must be unique.");
    }

    const consumedCards = resourceCardInstanceIds.map((resourceCardInstanceId) => {
      if (resourceCardInstanceId === sourceCardInstanceId) {
        throw new CommandError("INVALID_RESOURCE_COST", "A card cannot consume itself as a resource.");
      }

      return this.findCardInHand(playerId, resourceCardInstanceId).card;
    });

    return {
      consumedCards
    };
  }

  private assertCanPayCardCosts(player: PlayerState, definition: CardDefinition): void {
    if (player.energy < definition.cost) {
      throw new CommandError("NOT_ENOUGH_ENERGY", `${definition.name} costs ${definition.cost} energy.`);
    }

    const hpCost = definition.resourceCosts?.hp ?? 0;
    if (hpCost > 0 && player.hp <= hpCost) {
      throw new CommandError(
        "NOT_ENOUGH_HP",
        `${definition.name} requires ${hpCost} HP and cannot reduce the player to 0 HP.`
      );
    }
  }

  private payAdditionalCardCosts(
    playerId: string,
    sourceCard: CardInstance,
    definition: CardDefinition,
    payment: PlayResourcePayment
  ): GameEvent[] {
    const events: GameEvent[] = [];

    for (const consumedCard of payment.consumedCards) {
      events.push(...this.revertPendingCardTransformForLeavingHand(playerId, consumedCard));
      const consumedDefinition = this.getCardDefinition(consumedCard.cardId);
      this.removeCardFromHand(playerId, consumedCard.instanceId);
      const destinationZone = this.getReadyActionTag(consumedDefinition)
        ? this.moveCardToPrepared(consumedCard)
        : this.moveCardToExhaust(consumedCard);

      events.push({
        type: "CARD_CONSUMED",
        seq: this.nextSeq(),
        payload: {
          playerId,
          cardInstanceId: consumedCard.instanceId,
          cardId: consumedCard.cardId,
          sourceCardInstanceId: sourceCard.instanceId,
          destinationZone
        }
      } satisfies CardConsumedEvent);
    }

    const hpCost = definition.resourceCosts?.hp ?? 0;
    if (hpCost > 0) {
      const player = this.state.players[playerId];
      player.hp -= hpCost;
      events.push({
        type: "HP_PAID",
        seq: this.nextSeq(),
        payload: {
          playerId,
          sourceCardInstanceId: sourceCard.instanceId,
          amount: hpCost,
          hpAfter: player.hp
        }
      } satisfies HpPaidEvent);
    }

    return events;
  }

  private resolveAutomaticActionTargetIds(
    definition: CardDefinition,
    playerId: string
  ): string[] | null {
    const targeting = getCardTargeting(definition);
    if (targeting.requiresTarget) {
      return null;
    }

    const targetIds = getAutomaticTargetIds(this.state, playerId, targeting);
    if ((definition.effect.type === "DAMAGE" || definition.effect.type === "HEAL") && targetIds.length === 0) {
      return null;
    }

    return targetIds;
  }

  private resolveActionTargetIds(
    definition: CardDefinition,
    playerId: string,
    targetId?: string
  ): string[] {
    const resolvedTargetIds = this.resolveTargetIds(definition, playerId, targetId);
    this.assertEffectTargetsResolved(definition, resolvedTargetIds);
    return resolvedTargetIds;
  }

  private resolveTriggeredActionEvents(
    playerId: string,
    card: CardInstance,
    definition: CardDefinition,
    actionTag: CardActionTag,
    targetIds: string[]
  ): GameEvent[] {
    const actionEvent: CardActionTriggeredEvent = {
      type: "CARD_ACTION_TRIGGERED",
      seq: this.nextSeq(),
      payload: {
        playerId,
        cardInstanceId: card.instanceId,
        cardId: definition.cardId,
        actionTag: actionTag.type,
        trigger: actionTag.trigger,
        targetId: targetIds[0],
        targetIds
      }
    };

    const effectEvents = resolveCardEffect({
      state: this.state,
      sourceCard: card,
      sourceDefinition: definition,
      playerId,
      targetIds,
      nextSeq: () => this.nextSeq(),
      drawCards: (drawingPlayerId, count) => this.drawCards(drawingPlayerId, count)
    });

    return [
      actionEvent,
      ...effectEvents,
      ...(this.state.status !== "ENDED"
        ? this.resolvePreparedActionTriggers({
            sourcePlayerId: playerId,
            sourceDefinition: definition,
            targetIds,
            effectEvents
          })
        : [])
    ];
  }

  private movePlayedCardToDestination(card: CardInstance, definition: CardDefinition): CardZone {
    return definition.consumable ? this.moveCardToExhaust(card) : this.moveCardToTemporary(card);
  }

  private moveCardToPrepared(card: CardInstance): CardZone {
    card.zone = "PREPARED";
    this.state.zones.prepared[card.ownerId] ??= [];
    this.state.zones.prepared[card.ownerId].push(card);
    return card.zone;
  }

  private moveCardToTemporary(card: CardInstance): CardZone {
    card.zone = "TEMPORARY";
    this.state.zones.temporary[card.ownerId] ??= [];
    this.state.zones.temporary[card.ownerId].push(card);
    return card.zone;
  }

  private moveCardToExhaust(card: CardInstance): CardZone {
    card.zone = "EXHAUST";
    this.state.zones.exhaust[card.ownerId] ??= [];
    this.state.zones.exhaust[card.ownerId].push(card);
    return card.zone;
  }

  private resolveRetainedEnergy(player: PlayerState): number {
    const strengthModifier = Math.max(0, this.assertPlayerCharacter(player).abilityModifiers.strength);
    return Math.min(Math.max(0, player.energy), strengthModifier);
  }

  private resolveTurnDrawCount(player: PlayerState): number {
    const dexterityBonus = Math.max(0, this.assertPlayerCharacter(player).abilityModifiers.dexterity);
    return Math.max(0, player.drawPerTurn + dexterityBonus);
  }

  private resolveHandRetainCount(player: PlayerState): number {
    return Math.max(0, this.assertPlayerCharacter(player).abilityModifiers.intelligence);
  }

  private applyTransformRules(playerId: string, triggerCard: CardInstance): CardTransformedEvent[] {
    const events: CardTransformedEvent[] = [];
    const rules = this.transformRules.filter((rule) => rule.triggerCardId === triggerCard.cardId);

    for (const rule of rules) {
      const cards = this.getCardsInTransformScope(playerId, rule);
      for (const card of cards) {
        if (card.cardId !== rule.sourceCardId) {
          continue;
        }

        events.push(this.transformCard(playerId, card, rule, triggerCard.instanceId, rule.targetCardId));

        if (rule.reversible && rule.revertTiming !== "NEVER") {
          this.pendingCardReverts.push({
            ruleId: rule.ruleId,
            playerId,
            sourceId: triggerCard.instanceId,
            cardInstanceId: card.instanceId,
            sourceCardId: rule.sourceCardId,
            targetCardId: rule.targetCardId,
            revertTiming: rule.revertTiming
          });
        }
      }
    }

    return events;
  }

  private revertPendingCardTransforms(
    playerId: string,
    revertTiming: Exclude<CardTransformRevertTiming, "NEVER">
  ): CardTransformedEvent[] {
    const events: CardTransformedEvent[] = [];
    const remainingReverts: PendingCardRevert[] = [];

    for (const pending of this.pendingCardReverts) {
      if (pending.playerId !== playerId || pending.revertTiming !== revertTiming) {
        remainingReverts.push(pending);
        continue;
      }

      const card = (this.state.zones.hand[playerId] ?? []).find(
        (candidate) => candidate.instanceId === pending.cardInstanceId
      );

      if (card?.cardId === pending.targetCardId) {
        events.push(
          this.transformCard(
            playerId,
            card,
            {
              ruleId: pending.ruleId,
              triggerCardId: pending.sourceCardId,
              sourceCardId: pending.targetCardId,
              targetCardId: pending.sourceCardId,
              scope: "OWNER_HAND",
              reversible: false,
              revertTiming: "NEVER"
            },
            pending.sourceId,
            pending.sourceCardId
          )
        );
      }
    }

    this.pendingCardReverts = remainingReverts;
    return events;
  }

  private revertPendingCardTransformForLeavingHand(
    playerId: string,
    card: CardInstance
  ): CardTransformedEvent[] {
    const matchedReverts: PendingCardRevert[] = [];
    const remainingReverts: PendingCardRevert[] = [];

    for (const pending of this.pendingCardReverts) {
      if (pending.playerId === playerId && pending.cardInstanceId === card.instanceId) {
        matchedReverts.push(pending);
        continue;
      }

      remainingReverts.push(pending);
    }

    const events = matchedReverts.reverse().flatMap((pending) => {
      if (card.cardId !== pending.targetCardId) {
        return [];
      }

      return [
        this.transformCard(
          playerId,
          card,
          {
            ruleId: pending.ruleId,
            triggerCardId: pending.sourceCardId,
            sourceCardId: pending.targetCardId,
            targetCardId: pending.sourceCardId,
            scope: "OWNER_HAND",
            reversible: false,
            revertTiming: "NEVER"
          },
          pending.sourceId,
          pending.sourceCardId
        )
      ];
    });

    this.pendingCardReverts = remainingReverts;
    return events;
  }

  private transformCard(
    playerId: string,
    card: CardInstance,
    rule: CardTransformRule,
    sourceId: string,
    targetCardId: string
  ): CardTransformedEvent {
    const previousCardId = card.cardId;
    card.cardId = targetCardId;

    return {
      type: "CARD_TRANSFORMED",
      seq: this.nextSeq(),
      payload: {
        playerId,
        ruleId: rule.ruleId,
        sourceId,
        cardInstanceId: card.instanceId,
        privateCardData: {
          previousCardId,
          cardId: targetCardId
        }
      }
    };
  }

  private getCardsInTransformScope(playerId: string, rule: CardTransformRule): CardInstance[] {
    switch (rule.scope) {
      case "OWNER_HAND":
        return this.state.zones.hand[playerId] ?? [];
    }
  }

  private canStartGame(): boolean {
    return (
      this.state.playerOrder.length >= 2 &&
      this.state.playerOrder.every((playerId) => {
        const player = this.state.players[playerId];
        return player.ready && Boolean(player.character);
      })
    );
  }

  private createCharacter(config: CharacterConfig) {
    try {
      return validateAndCreateCharacter(config, this.races);
    } catch (error) {
      throw new CommandError(
        "INVALID_CHARACTER",
        error instanceof Error ? error.message : "Character configuration is invalid."
      );
    }
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

  private removeCardFromHand(playerId: string, cardInstanceId: string): CardInstance {
    const { card, index } = this.findCardInHand(playerId, cardInstanceId);
    this.state.zones.hand[playerId].splice(index, 1);
    return card;
  }

  private getCardDefinition(cardId: string): CardDefinition {
    const definition = this.cardDefinitions[cardId];
    if (!definition) {
      throw new CommandError("UNKNOWN_CARD", `Card definition ${cardId} does not exist.`);
    }

    return definition;
  }

  private resolveTargetIds(
    definition: CardDefinition,
    playerId: string,
    targetId?: string
  ): string[] {
    const targeting = getCardTargeting(definition);

    if (targeting.requiresTarget && !targetId) {
      throw new CommandError("INVALID_TARGET", `${definition.name} requires a target.`);
    }

    if (!targeting.requiresTarget) {
      return getAutomaticTargetIds(this.state, playerId, targeting);
    }

    if (!targetId) {
      throw new CommandError("INVALID_TARGET", `${definition.name} requires a target.`);
    }

    const requiredTargetId = targetId;

    if (!this.state.players[requiredTargetId]) {
      throw new CommandError("INVALID_TARGET", `Target ${requiredTargetId} does not exist.`);
    }

    if (!isPlayerTargetAllowed(this.state, playerId, requiredTargetId, targeting)) {
      throw new CommandError(
        "INVALID_TARGET",
        `${definition.name} cannot target ${requiredTargetId} with ${targeting.scope.toLowerCase()} targeting.`
      );
    }

    return [requiredTargetId];
  }

  private assertEffectTargetsResolved(definition: CardDefinition, targetIds: string[]): void {
    if ((definition.effect.type === "DAMAGE" || definition.effect.type === "HEAL") && targetIds.length === 0) {
      throw new CommandError("INVALID_TARGET", `${definition.name} cannot resolve an effect target.`);
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

  private assertMainPhase(): void {
    if (this.state.turnPhase !== "MAIN") {
      throw new CommandError("DISCARD_REQUIRED", "Finish discarding before taking another action.");
    }
  }

  private assertDiscardAllowed(playerId: string): void {
    if (this.state.turnPhase !== "DISCARD") {
      return;
    }

    if (this.state.pendingDiscard?.playerId !== playerId) {
      throw new CommandError("DISCARD_REQUIRED", "Only the discarding player can discard cards now.");
    }
  }

  private assertKnownPlayer(playerId: string): void {
    if (!this.state.players[playerId]) {
      throw new CommandError("UNKNOWN_PLAYER", `Player ${playerId} does not exist.`);
    }
  }

  private assertPlayerCharacter(player: PlayerState): CharacterState {
    if (!player.character) {
      throw new CommandError("CHARACTER_REQUIRED", `${player.name} has not set a character.`);
    }

    return player.character;
  }

  private findPlayerBySession(clientSessionId: string): PlayerState | null {
    const sessionId = clientSessionId.trim();
    if (!sessionId) {
      return null;
    }

    return this.state.playerOrder
      .map((playerId) => this.state.players[playerId])
      .find((player) => player.clientSessionId === sessionId) ?? null;
  }

  private nextSeq(): number {
    this.state.eventSeq += 1;
    return this.state.eventSeq;
  }
}

function getDefaultTeamId(playerIndex: number): string {
  return playerIndex % 2 === 0 ? "team_1" : "team_2";
}
