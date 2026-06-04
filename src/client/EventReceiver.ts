import type { GameEvent, NetworkMessage } from "../shared/types/network.js";

export class EventReceiver {
  parse(rawMessage: unknown): GameEvent | NetworkMessage {
    if (typeof rawMessage === "string") {
      return JSON.parse(rawMessage) as GameEvent | NetworkMessage;
    }

    if (Buffer.isBuffer(rawMessage)) {
      return JSON.parse(rawMessage.toString("utf8")) as GameEvent | NetworkMessage;
    }

    if (rawMessage instanceof ArrayBuffer) {
      return JSON.parse(Buffer.from(rawMessage).toString("utf8")) as GameEvent | NetworkMessage;
    }

    return rawMessage as GameEvent | NetworkMessage;
  }
}
