import { DEFAULT_CARD_CATALOG } from "../shared/rules/cardDefinitions.js";
import { DEFAULT_RACES, validateAndCreateCharacter } from "../shared/rules/characterRules.js";
import { resolveCardEffect, type BeforeDamageHitResult } from "../shared/rules/cardEffects.js";
import { canUseCardForConsumeCost } from "../shared/rules/cardResources.js";
import {
  getAutomaticTargetIds,
  getCardTargeting,
  getSelectableTargetIds,
  isPlayerTargetAllowed
} from "../shared/rules/cardTargets.js";
import {
  calculateHandDiscardRequirements,
  calculateStatusRetainCount,
  type HandDiscardRequirements
} from "../shared/rules/handRetention.js";
import type { CardActionTag, CardDefinition, CardInstance, CardZone } from "../shared/types/card.js";
import type { CardCatalog, CardTransformRevertTiming, CardTransformRule } from "../shared/types/cardCatalog.js";
import type { CharacterConfig, CharacterState, RaceDefinition } from "../shared/types/character.js";
import type { GameState, PlayerState } from "../shared/types/game.js";
import type {
  CardAddedToHandEvent,
  CardConsumedEvent,
  CardDrawnEvent,
  CardActionTriggeredEvent,
  DamagePreventedEvent,
  CardResolvedEvent,
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
};

type ConsumedCardPayment = {
  card: CardInstance;
  preparedTargetIds?: string[];
};

type PlayResourcePayment = {
  consumedCards: ConsumedCardPayment[];
};

type ResolvedCardDestinationZone = Extract<CardZone, "TEMPORARY" | "EXHAUST">;

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
    resourceCardInstanceIds: string[] = [],
    resourceTargets: Record<string, string> = {}
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
      resourceCardInstanceIds,
      resourceTargets
    );
    const player = this.state.players[playerId];

    this.assertCanPayCardCosts(player, definition);

    if (preparedActionTag) {
      const events = this.payAdditionalCardCosts(playerId, card, definition, resourcePayment);
      const preparedTargetIds = preparedActionTag.type === "READY_ACTION"
        ? this.resolveConsumedReadyActionTargetIds(playerId, definition, targetId)
        : undefined;
      player.energy -= definition.cost;
      this.removeCardFromHand(playerId, cardInstanceId);
      this.setPreparedTargetIds(card, preparedTargetIds);
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
    const destinationZone = this.moveCardToResolving(card);

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

    events.push(
      ...this.resolveCardFromResolving(playerId, card, definition, resolvedTargetIds, {
        finalDestinationZone: this.getPlayedCardDestinationZone(definition),
        triggerPreparedActions: true,
        revertSourceForLeavingHand: true
      })
    );

    return events;
  }

  discardCard(playerId: string, cardInstanceId: string, targetId?: string): GameEvent[] {
    this.assertPlaying();
    this.assertCurrentPlayer(playerId);
    this.assertDiscardAllowed(playerId);

    const { card, index } = this.findCardInHand(playerId, cardInstanceId);
    const definition = this.getCardDefinition(card.cardId);
    this.assertPendingDiscardCardAllowed(playerId, definition);
    const actionTag = this.getTriggeredDiscardActionTag(definition);
    const resolvesStatus = this.shouldResolveStatusOnDiscard(definition);
    const shouldResolveDiscard = Boolean(actionTag || resolvesStatus);
    const actionTargetIds = shouldResolveDiscard
      ? this.resolveActionTargetIds(definition, playerId, targetId)
      : [];

    this.state.zones.hand[playerId].splice(index, 1);
    const revertEvents = this.revertPendingCardTransformForLeavingHand(playerId, card);
    const destinationZone = shouldResolveDiscard
      ? this.moveCardToResolving(card)
      : this.moveCardToTemporary(card);

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
    ];

    if (actionTag) {
      events.push(
        ...this.resolveTriggeredActionEvents(
          playerId,
          card,
          definition,
          actionTag,
          actionTargetIds,
          this.getDiscardResolutionDestinationZone(definition)
        )
      );
    } else if (resolvesStatus) {
      events.push(
        ...this.resolveCardFromResolving(playerId, card, definition, actionTargetIds, {
          finalDestinationZone: this.getDiscardResolutionDestinationZone(definition),
          triggerPreparedActions: true,
          revertSourceForLeavingHand: false
        })
      );
    }

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
    const statusRetainCount = this.resolveStatusHandRetainCount(this.state.players[playerId], retainCount);
    const requirements = this.resolveHandDiscardRequirements(playerId, retainCount, statusRetainCount);

    if (requirements.discardCount > 0) {
      this.state.turnPhase = "DISCARD";
      this.state.pendingDiscard = {
        playerId,
        retainCount,
        statusRetainCount
      };

      return [
        {
          type: "DISCARD_PHASE_STARTED",
          seq: this.nextSeq(),
          payload: {
            playerId,
            retainCount,
            statusRetainCount,
            discardCount: requirements.discardCount
          }
        }
      ];
    }

    return this.completeTurn(playerId);
  }

  private completeTurn(playerId: string): GameEvent[] {
    this.state.turnPhase = "MAIN";
    this.state.pendingDiscard = null;

    const events: GameEvent[] = this.resolveEndTurnStatusTriggers(playerId);
    events.push({
      type: "TURN_ENDED",
      seq: this.nextSeq(),
      payload: {
        playerId,
        turn: this.state.turn
      }
    });
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

    return this.resolveHandDiscardRequirements(
      playerId,
      pendingDiscard.retainCount,
      pendingDiscard.statusRetainCount
    ).discardCount === 0;
  }

  private resolveHandDiscardRequirements(
    playerId: string,
    retainCount: number,
    statusRetainCount: number
  ): HandDiscardRequirements {
    const hand = this.state.zones.hand[playerId] ?? [];
    const statusCardCount = hand.filter(
      (card) => this.getCardDefinition(card.cardId).type === "STATUS"
    ).length;

    return calculateHandDiscardRequirements({
      retainCount,
      statusRetainCount,
      statusCardCount,
      nonStatusCardCount: hand.length - statusCardCount
    });
  }

  private getTriggeredDiscardActionTag(definition: CardDefinition): CardActionTag | null {
    return definition.actionTags?.find(
      (tag) => tag.type === "BONUS_ACTION" && tag.trigger === "DISCARD"
    ) ?? null;
  }

  private shouldResolveStatusOnDiscard(definition: CardDefinition): boolean {
    return definition.type === "STATUS";
  }

  private getDiscardResolutionDestinationZone(definition: CardDefinition): ResolvedCardDestinationZone {
    return definition.type === "STATUS" ? this.getPlayedCardDestinationZone(definition) : "TEMPORARY";
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

  private getEndTurnStatusActionTag(definition: CardDefinition): CardActionTag | null {
    return definition.actionTags?.find((tag) => tag.type === "END_TURN_STATUS") ?? null;
  }

  private resolveEndTurnStatusTriggers(playerId: string): GameEvent[] {
    const triggeringCards = [...(this.state.zones.hand[playerId] ?? [])]
      .map((card) => ({ card, definition: this.getCardDefinition(card.cardId) }))
      .filter(({ definition }) => Boolean(this.getEndTurnStatusActionTag(definition)));
    const events: GameEvent[] = [];

    for (const { card, definition } of triggeringCards) {
      const actionTag = this.getEndTurnStatusActionTag(definition);
      if (!actionTag) {
        continue;
      }

      events.push({
        type: "CARD_ACTION_TRIGGERED",
        seq: this.nextSeq(),
        payload: {
          playerId,
          cardInstanceId: card.instanceId,
          cardId: definition.cardId,
          actionTag: actionTag.type,
          trigger: actionTag.trigger,
          destinationZone: "HAND",
          targetId: playerId,
          targetIds: [playerId]
        }
      });
      events.push(...this.resolveCardEffectEvents(playerId, card, definition, [playerId]));
    }

    return events;
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
    const destinationZone = this.moveCardToResolving(card);
    const targetIds = this.resolvePreparedActionTargetIds(actionTag, playerId, card, definition, defaultTargetId);
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

    if (!this.canResolvePreparedActionTargets(playerId, definition, targetIds)) {
      events.push(
        this.resolveCardToFinalZone(playerId, card, "EXHAUST", {
          cancelled: true,
          cancelReason: "INVALID_TARGET"
        })
      );
      return events;
    }

    events.push(
      ...this.resolveCardFromResolving(playerId, card, definition, targetIds, {
        finalDestinationZone: this.getPlayedCardDestinationZone(definition),
        triggerPreparedActions: false,
        revertSourceForLeavingHand: false
      })
    );
    return events;
  }

  private resolvePreparedActionTargetIds(
    actionTag: CardActionTag,
    playerId: string,
    card: CardInstance,
    definition: CardDefinition,
    defaultTargetId: string
  ): string[] {
    if (actionTag.type === "READY_ACTION") {
      return card.preparedTargetIds ?? this.resolveAutomaticActionTargetIds(definition, playerId) ?? [];
    }

    const automaticTargetIds = this.resolveAutomaticActionTargetIds(definition, playerId);
    if (automaticTargetIds !== null) {
      return automaticTargetIds;
    }

    return [defaultTargetId];
  }

  private canResolvePreparedActionTargets(
    playerId: string,
    definition: CardDefinition,
    targetIds: string[]
  ): boolean {
    const targeting = getCardTargeting(definition);
    if (targeting.requiresTarget && targetIds.length === 0) {
      return false;
    }

    if (this.hasPlayerEffect(definition) && targetIds.length === 0) {
      return false;
    }

    return targetIds.every((targetId) => {
      const target = this.state.players[targetId];
      return Boolean(
        target &&
        target.hp > 0 &&
        isPlayerTargetAllowed(this.state, playerId, targetId, targeting)
      );
    });
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
    resourceCardInstanceIds: string[],
    resourceTargets: Record<string, string>
  ): PlayResourcePayment {
    const consumeCardCount = definition.resourceCosts?.consumeCardCount ?? 0;
    const resourceTargetCardIds = Object.keys(resourceTargets);

    if (consumeCardCount === 0) {
      if (resourceCardInstanceIds.length > 0 || resourceTargetCardIds.length > 0) {
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

    const consumedCardIds = new Set(resourceCardInstanceIds);
    for (const resourceTargetCardId of resourceTargetCardIds) {
      if (!consumedCardIds.has(resourceTargetCardId)) {
        throw new CommandError(
          "INVALID_RESOURCE_TARGET",
          `Resource target was provided for unselected card ${resourceTargetCardId}.`
        );
      }
    }

    const consumedCards = resourceCardInstanceIds.map((resourceCardInstanceId) => {
      if (resourceCardInstanceId === sourceCardInstanceId) {
        throw new CommandError("INVALID_RESOURCE_COST", "A card cannot consume itself as a resource.");
      }

      const card = this.findCardInHand(playerId, resourceCardInstanceId).card;
      const consumedDefinition = this.getCardDefinition(card.cardId);
      if (!canUseCardForConsumeCost(consumedDefinition)) {
        throw new CommandError(
          "INVALID_RESOURCE_COST",
          "Status cards cannot be consumed as additional card resources."
        );
      }
      const preparedTargetIds = this.getReadyActionTag(consumedDefinition)
        ? this.resolveConsumedReadyActionTargetIds(playerId, consumedDefinition, resourceTargets[card.instanceId])
        : undefined;
      return {
        card,
        preparedTargetIds
      };
    });

    return {
      consumedCards
    };
  }

  private resolveConsumedReadyActionTargetIds(
    playerId: string,
    definition: CardDefinition,
    targetId?: string
  ): string[] {
    const targeting = getCardTargeting(definition);
    const resolvedTargetId = targetId ?? this.getAutoSelectedPreparedTargetId(playerId, targeting);
    const targetIds = this.resolveTargetIds(definition, playerId, resolvedTargetId);
    this.assertEffectTargetsResolved(definition, targetIds);
    return targetIds;
  }

  private getAutoSelectedPreparedTargetId(playerId: string, targeting: CardDefinition["targeting"]): string | undefined {
    if (!targeting.requiresTarget || targeting.selection !== "SINGLE") {
      return undefined;
    }

    const selectableTargetIds = getSelectableTargetIds(this.state, playerId, targeting);
    return selectableTargetIds.length === 1 ? selectableTargetIds[0] : undefined;
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

    for (const consumedCardPayment of payment.consumedCards) {
      const consumedCard = consumedCardPayment.card;
      const consumedDefinition = this.getCardDefinition(consumedCard.cardId);
      const isConsumedAsReadyAction = Boolean(this.getReadyActionTag(consumedDefinition));
      if (isConsumedAsReadyAction) {
        this.clearPendingCardTransformForLeavingHand(playerId, consumedCard);
        this.setPreparedTargetIds(consumedCard, consumedCardPayment.preparedTargetIds);
      } else {
        events.push(...this.revertPendingCardTransformForLeavingHand(playerId, consumedCard));
        delete consumedCard.preparedTargetIds;
      }

      this.removeCardFromHand(playerId, consumedCard.instanceId);
      const destinationZone = isConsumedAsReadyAction
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
          destinationZone,
          targetId: consumedCardPayment.preparedTargetIds?.[0],
          targetIds: consumedCardPayment.preparedTargetIds
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
    if (this.hasPlayerEffect(definition) && targetIds.length === 0) {
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
    targetIds: string[],
    finalDestinationZone: ResolvedCardDestinationZone = "TEMPORARY"
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
        destinationZone: "RESOLVING",
        targetId: targetIds[0],
        targetIds
      }
    };

    return [
      actionEvent,
      ...this.resolveCardFromResolving(playerId, card, definition, targetIds, {
        finalDestinationZone,
        triggerPreparedActions: true,
        revertSourceForLeavingHand: false
      })
    ];
  }

  private resolveCardFromResolving(
    playerId: string,
    card: CardInstance,
    definition: CardDefinition,
    targetIds: string[],
    options: {
      finalDestinationZone: ResolvedCardDestinationZone;
      triggerPreparedActions: boolean;
      revertSourceForLeavingHand: boolean;
    }
  ): GameEvent[] {
    const events: GameEvent[] = [];
    const effectEvents = this.getEndTurnStatusActionTag(definition)
      ? []
      : this.resolveCardEffectEvents(
          playerId,
          card,
          definition,
          targetIds,
          options.triggerPreparedActions
        );

    events.push(...effectEvents);
    if (options.triggerPreparedActions && this.state.status !== "ENDED") {
      events.push(
        ...this.resolvePreparedActionTriggers({
          sourcePlayerId: playerId,
          sourceDefinition: definition,
          targetIds
        })
      );
    }

    events.push(...this.applyTransformRules(playerId, card));
    if (options.revertSourceForLeavingHand) {
      events.push(...this.revertPendingCardTransformForLeavingHand(playerId, card));
    }
    events.push(this.resolveCardToFinalZone(playerId, card, options.finalDestinationZone));
    return events;
  }

  private resolveCardEffectEvents(
    playerId: string,
    card: CardInstance,
    definition: CardDefinition,
    targetIds: string[],
    allowDamageReactions = false
  ): GameEvent[] {
    return resolveCardEffect({
      state: this.state,
      sourceCard: card,
      sourceDefinition: definition,
      playerId,
      targetIds,
      nextSeq: () => this.nextSeq(),
      drawCards: (drawingPlayerId, count) => this.drawCards(drawingPlayerId, count),
      addCardsToHand: (receivingPlayerId, cardId, count) =>
        this.addCardsToHand(receivingPlayerId, cardId, count, card.instanceId),
      beforeDamageHit: allowDamageReactions
        ? (targetId, amount) => this.resolveDamageReaction(playerId, card, targetId, amount)
        : undefined
    });
  }

  private resolveDamageReaction(
    sourcePlayerId: string,
    sourceCard: CardInstance,
    targetId: string,
    amount: number
  ): BeforeDamageHitResult {
    if (sourcePlayerId === targetId) {
      return { prevented: false, events: [] };
    }

    const reactionCard = (this.state.zones.prepared[targetId] ?? []).find((card) => {
      const actionTag = this.getPreparedActionTag(this.getCardDefinition(card.cardId));
      return actionTag?.type === "REACTION_ACTION";
    });
    if (!reactionCard) {
      return { prevented: false, events: [] };
    }

    const definition = this.getCardDefinition(reactionCard.cardId);
    const actionTag = this.getPreparedActionTag(definition);
    if (!actionTag || actionTag.type !== "REACTION_ACTION") {
      return { prevented: false, events: [] };
    }

    const events = this.resolvePreparedActionCard(
      targetId,
      reactionCard,
      definition,
      actionTag,
      "DAMAGE_TARGETED",
      sourcePlayerId
    );
    events.push({
      type: "DAMAGE_PREVENTED",
      seq: this.nextSeq(),
      payload: {
        sourceId: sourceCard.instanceId,
        targetId,
        amount,
        preventedByCardInstanceId: reactionCard.instanceId
      }
    } satisfies DamagePreventedEvent);

    return { prevented: true, events };
  }

  private getPlayedCardDestinationZone(definition: CardDefinition): ResolvedCardDestinationZone {
    return definition.consumable ? "EXHAUST" : "TEMPORARY";
  }

  private addCardsToHand(
    playerId: string,
    cardId: string,
    count: number,
    sourceId: string
  ): CardAddedToHandEvent[] {
    this.assertKnownPlayer(playerId);
    this.getCardDefinition(cardId);
    const hand = this.state.zones.hand[playerId] ??= [];
    const events: CardAddedToHandEvent[] = [];

    for (let index = 0; index < count; index += 1) {
      const card = this.deckManager.createCard(cardId, playerId, "HAND");
      hand.push(card);
      events.push({
        type: "CARD_ADDED_TO_HAND",
        seq: this.nextSeq(),
        payload: {
          playerId,
          sourceId,
          cardInstanceId: card.instanceId,
          privateCardData: {
            cardId
          }
        }
      });
    }

    return events;
  }

  private moveCardToPrepared(card: CardInstance): CardZone {
    card.zone = "PREPARED";
    this.state.zones.prepared[card.ownerId] ??= [];
    this.state.zones.prepared[card.ownerId].push(card);
    return card.zone;
  }

  private setPreparedTargetIds(card: CardInstance, targetIds: string[] | undefined): void {
    if (targetIds && targetIds.length > 0) {
      card.preparedTargetIds = targetIds;
      return;
    }

    delete card.preparedTargetIds;
  }

  private moveCardToResolving(card: CardInstance): CardZone {
    card.zone = "RESOLVING";
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

  private resolveCardToFinalZone(
    playerId: string,
    card: CardInstance,
    destinationZone: ResolvedCardDestinationZone,
    options: {
      cancelled?: boolean;
      cancelReason?: string;
    } = {}
  ): CardResolvedEvent {
    delete card.preparedTargetIds;
    const finalZone = destinationZone === "EXHAUST"
      ? this.moveCardToExhaust(card)
      : this.moveCardToTemporary(card);

    return {
      type: "CARD_RESOLVED",
      seq: this.nextSeq(),
      payload: {
        playerId,
        cardInstanceId: card.instanceId,
        cardId: card.cardId,
        destinationZone: finalZone,
        ...(options.cancelled ? { cancelled: true, cancelReason: options.cancelReason } : {})
      }
    };
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

  private resolveStatusHandRetainCount(player: PlayerState, retainCount: number): number {
    const constitutionModifier = this.assertPlayerCharacter(player).abilityModifiers.constitution;
    return calculateStatusRetainCount(retainCount, constitutionModifier);
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

  private clearPendingCardTransformForLeavingHand(playerId: string, card: CardInstance): void {
    this.pendingCardReverts = this.pendingCardReverts.filter(
      (pending) => pending.playerId !== playerId || pending.cardInstanceId !== card.instanceId
    );
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
    if (this.hasPlayerEffect(definition) && targetIds.length === 0) {
      throw new CommandError("INVALID_TARGET", `${definition.name} cannot resolve an effect target.`);
    }
  }

  private hasPlayerEffect(definition: CardDefinition): boolean {
    return (
      definition.effect.type === "DAMAGE" ||
      definition.effect.type === "HEAL" ||
      definition.effect.type === "LOSE_HP" ||
      definition.effect.type === "LOSE_ENERGY" ||
      definition.effect.type === "ADD_CARD_TO_HAND"
    );
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

  private assertPendingDiscardCardAllowed(playerId: string, definition: CardDefinition): void {
    const pendingDiscard = this.state.pendingDiscard;
    if (this.state.turnPhase !== "DISCARD" || pendingDiscard?.playerId !== playerId) {
      return;
    }

    const requirements = this.resolveHandDiscardRequirements(
      playerId,
      pendingDiscard.retainCount,
      pendingDiscard.statusRetainCount
    );

    if (requirements.phase === "NON_STATUS" && definition.type === "STATUS") {
      throw new CommandError(
        "DISCARD_ORDER_REQUIRED",
        "Discard the required non-status cards before discarding status cards."
      );
    }

    if (requirements.phase === "STATUS" && definition.type !== "STATUS") {
      throw new CommandError(
        "DISCARD_ORDER_REQUIRED",
        "Discard the required status cards to finish the turn."
      );
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
