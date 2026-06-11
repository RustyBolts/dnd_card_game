import type { CardInstance, VisibleCardInstance } from "./card.js";
import type { CharacterState } from "./character.js";

export type GameStatus = "WAITING" | "PLAYING" | "ENDED";

export type PlayerState = {
  playerId: string;
  name: string;
  teamId: string;
  character: CharacterState;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  connected: boolean;
  ready: boolean;
};

export type GameZones = {
  deck: Record<string, CardInstance[]>;
  hand: Record<string, CardInstance[]>;
  board: CardInstance[];
  graveyard: CardInstance[];
  exile: CardInstance[];
};

export type GameState = {
  roomId: string;
  status: GameStatus;
  turn: number;
  currentPlayerId: string | null;
  playerOrder: string[];
  players: Record<string, PlayerState>;
  zones: GameZones;
  eventSeq: number;
  winnerId: string | null;
};

export type VisibleGameZones = {
  deckCounts: Record<string, number>;
  hand: Record<string, VisibleCardInstance[]>;
  handCounts: Record<string, number>;
  board: VisibleCardInstance[];
  graveyard: VisibleCardInstance[];
  exile: VisibleCardInstance[];
};

export type VisibleGameState = Omit<GameState, "zones"> & {
  viewerId: string;
  zones: VisibleGameZones;
};
