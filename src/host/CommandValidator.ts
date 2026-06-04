import type { GameCommand } from "../shared/types/network.js";
import { CommandError } from "./CommandError.js";

export class CommandValidator {
  parse(rawMessage: unknown): GameCommand {
    const message = this.parseJson(rawMessage);
    if (!isRecord(message) || typeof message.type !== "string") {
      throw new CommandError("INVALID_MESSAGE", "Message must be an object with a type.");
    }

    const requestId = typeof message.requestId === "string" ? message.requestId : createRequestId();

    switch (message.type) {
      case "JOIN_ROOM": {
        const payload = readPayload(message);
        const playerName = readString(payload, "playerName");
        return {
          type: "JOIN_ROOM",
          requestId,
          payload: {
            playerName
          }
        };
      }
      case "PLAYER_READY":
        return { type: "PLAYER_READY", requestId };
      case "DRAW_CARD":
        return { type: "DRAW_CARD", requestId };
      case "PLAY_CARD": {
        const payload = readPayload(message);
        const cardInstanceId = readString(payload, "cardInstanceId");
        const targetId = typeof payload.targetId === "string" ? payload.targetId : undefined;
        return {
          type: "PLAY_CARD",
          requestId,
          payload: {
            cardInstanceId,
            targetId
          }
        };
      }
      case "DISCARD_CARD": {
        const payload = readPayload(message);
        return {
          type: "DISCARD_CARD",
          requestId,
          payload: {
            cardInstanceId: readString(payload, "cardInstanceId")
          }
        };
      }
      case "END_TURN":
        return { type: "END_TURN", requestId };
      default:
        throw new CommandError("UNKNOWN_COMMAND", `Unsupported command type ${message.type}.`);
    }
  }

  private parseJson(rawMessage: unknown): unknown {
    if (typeof rawMessage === "string") {
      return JSON.parse(rawMessage);
    }

    if (Buffer.isBuffer(rawMessage)) {
      return JSON.parse(rawMessage.toString("utf8"));
    }

    if (rawMessage instanceof ArrayBuffer) {
      return JSON.parse(Buffer.from(rawMessage).toString("utf8"));
    }

    return rawMessage;
  }
}

function readPayload(message: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(message.payload)) {
    throw new CommandError("INVALID_PAYLOAD", "Command payload must be an object.");
  }

  return message.payload;
}

function readString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new CommandError("INVALID_PAYLOAD", `Payload field ${key} must be a non-empty string.`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createRequestId(): string {
  return `req_${Math.random().toString(36).slice(2, 10)}`;
}
