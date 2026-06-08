import type { CardDefinition } from "./card.js";
import type { PlayerState, VisibleGameState } from "./game.js";

export type NetworkMessage = {
  type: string;
  requestId?: string;
  seq?: number;
  playerId?: string;
  roomId?: string;
  payload?: unknown;
  error?: {
    code: string;
    message: string;
  };
};

export type JoinRoomCommand = {
  type: "JOIN_ROOM";
  requestId: string;
  payload: {
    playerName: string;
  };
};

export type PlayerReadyCommand = {
  type: "PLAYER_READY";
  requestId: string;
};

export type DrawCardCommand = {
  type: "DRAW_CARD";
  requestId: string;
};

export type PlayCardCommand = {
  type: "PLAY_CARD";
  requestId: string;
  payload: {
    cardInstanceId: string;
    targetId?: string;
  };
};

export type DiscardCardCommand = {
  type: "DISCARD_CARD";
  requestId: string;
  payload: {
    cardInstanceId: string;
  };
};

export type EndTurnCommand = {
  type: "END_TURN";
  requestId: string;
};

export type GameCommand =
  | JoinRoomCommand
  | PlayerReadyCommand
  | DrawCardCommand
  | PlayCardCommand
  | DiscardCardCommand
  | EndTurnCommand;

export type JoinAcceptedEvent = {
  type: "JOIN_ACCEPTED";
  seq: number;
  payload: {
    playerId: string;
    roomId: string;
  };
};

export type PlayerJoinedEvent = {
  type: "PLAYER_JOINED";
  seq: number;
  payload: {
    player: PlayerState;
  };
};

export type PlayerReadyChangedEvent = {
  type: "PLAYER_READY_CHANGED";
  seq: number;
  payload: {
    playerId: string;
    ready: boolean;
  };
};

export type GameStartedEvent = {
  type: "GAME_STARTED";
  seq: number;
  payload: {
    firstPlayerId: string;
  };
};

export type CardDrawnEvent = {
  type: "CARD_DRAWN";
  seq: number;
  payload: {
    playerId: string;
    cardInstanceId: string;
    privateCardData?: {
      cardId: string;
    };
  };
};

export type CardPlayedEvent = {
  type: "CARD_PLAYED";
  seq: number;
  payload: {
    playerId: string;
    cardInstanceId: string;
    cardId: string;
    targetId?: string;
  };
};

export type CardDiscardedEvent = {
  type: "CARD_DISCARDED";
  seq: number;
  payload: {
    playerId: string;
    cardInstanceId: string;
    cardId: string;
  };
};

export type DamageAppliedEvent = {
  type: "DAMAGE_APPLIED";
  seq: number;
  payload: {
    sourceId: string;
    targetId: string;
    amount: number;
    hpAfter: number;
  };
};

export type HealAppliedEvent = {
  type: "HEAL_APPLIED";
  seq: number;
  payload: {
    sourceId: string;
    targetId: string;
    amount: number;
    hpAfter: number;
  };
};

export type TurnStartedEvent = {
  type: "TURN_STARTED";
  seq: number;
  payload: {
    playerId: string;
    turn: number;
  };
};

export type TurnEndedEvent = {
  type: "TURN_ENDED";
  seq: number;
  payload: {
    playerId: string;
    turn: number;
  };
};

export type GameEndedEvent = {
  type: "GAME_ENDED";
  seq: number;
  payload: {
    winnerId: string;
  };
};

export type GameStateSyncEvent = {
  type: "GAME_STATE_SYNC";
  seq: number;
  payload: {
    state: VisibleGameState;
    cardDefinitions: Record<string, CardDefinition>;
    cardCatalogVersion: string;
  };
};

export type CommandRejectedEvent = {
  type: "COMMAND_REJECTED";
  seq: number;
  payload: {
    requestId?: string;
    code: string;
    message: string;
  };
};

export type GameEvent =
  | JoinAcceptedEvent
  | PlayerJoinedEvent
  | PlayerReadyChangedEvent
  | GameStartedEvent
  | CardDrawnEvent
  | CardPlayedEvent
  | CardDiscardedEvent
  | DamageAppliedEvent
  | HealAppliedEvent
  | TurnStartedEvent
  | TurnEndedEvent
  | GameEndedEvent
  | GameStateSyncEvent
  | CommandRejectedEvent;
