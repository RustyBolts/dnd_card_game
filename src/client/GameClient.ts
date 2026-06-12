import WebSocket from "ws";
import { CommandSender } from "./CommandSender.js";
import { EventReceiver } from "./EventReceiver.js";
import { LocalStateStore } from "./LocalStateStore.js";
import type { GameEvent, NetworkMessage } from "../shared/types/network.js";

export type GameClientOptions = {
  url: string;
  playerName: string;
};

export class GameClient {
  readonly localState = new LocalStateStore();
  readonly commands = new CommandSender(() => this.socket);

  private readonly receiver = new EventReceiver();
  private socket: WebSocket | null = null;
  private eventHandlers: Array<(event: GameEvent | NetworkMessage) => void> = [];

  constructor(private readonly options: GameClientOptions) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.options.url);
      this.socket = socket;

      socket.on("open", () => {
        this.commands.join(this.options.playerName);
        this.commands.setCharacter();
        resolve();
      });

      socket.on("message", (message) => this.handleMessage(message));
      socket.on("error", (error) => reject(error));
      socket.on("close", () => {
        this.socket = null;
      });
    });
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }

  onEvent(handler: (event: GameEvent | NetworkMessage) => void): void {
    this.eventHandlers.push(handler);
  }

  private handleMessage(rawMessage: WebSocket.RawData): void {
    const event = this.receiver.parse(rawMessage);
    if (isGameEvent(event)) {
      this.localState.apply(event);
    }

    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }
}

function isGameEvent(message: GameEvent | NetworkMessage): message is GameEvent {
  return typeof message.type === "string" && "seq" in message;
}
