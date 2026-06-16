import type { CardInstance, VisibleCardInstance } from "./card.js";
import type { CharacterState } from "./character.js";

export type GameStatus = "WAITING" | "PLAYING" | "ENDED";
export type TurnPhase = "WAITING" | "MAIN" | "DISCARD";

export type PendingDiscardState = {
  playerId: string;
  retainCount: number;
};

export type PlayerState = {
  playerId: string;
  name: string;
  clientSessionId: string;
  teamId: string;
  character: CharacterState | null;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  drawPerTurn: number;
  connected: boolean;
  ready: boolean;
};

export type GameZones = {
  deck: Record<string, CardInstance[]>;
  hand: Record<string, CardInstance[]>;
  prepared: Record<string, CardInstance[]>;
  resolving: Record<string, CardInstance[]>;
  temporary: Record<string, CardInstance[]>;
  exhaust: Record<string, CardInstance[]>;
  board: CardInstance[];
  graveyard: CardInstance[];
  exile: CardInstance[];
};

export type GameState = {
  roomId: string;
  status: GameStatus;
  turn: number;
  turnPhase: TurnPhase;
  pendingDiscard: PendingDiscardState | null;
  currentPlayerId: string | null;
  playerOrder: string[];
  players: Record<string, PlayerState>;
  zones: GameZones;
  eventSeq: number;
  winnerId: string | null;
};

export type VisibleGameZones = {
  deck: Record<string, VisibleCardInstance[]>;
  deckCounts: Record<string, number>;
  hand: Record<string, VisibleCardInstance[]>;
  handCounts: Record<string, number>;
  prepared: Record<string, VisibleCardInstance[]>;
  preparedCounts: Record<string, number>;
  resolving: Record<string, VisibleCardInstance[]>;
  resolvingCounts: Record<string, number>;
  temporary: Record<string, VisibleCardInstance[]>;
  temporaryCounts: Record<string, number>;
  exhaust: Record<string, VisibleCardInstance[]>;
  exhaustCounts: Record<string, number>;
  drawPreview: Record<string, VisibleCardInstance[]>;
  board: VisibleCardInstance[];
  graveyard: VisibleCardInstance[];
  exile: VisibleCardInstance[];
};

export type VisibleGameState = Omit<GameState, "zones"> & {
  viewerId: string;
  zones: VisibleGameZones;
};
