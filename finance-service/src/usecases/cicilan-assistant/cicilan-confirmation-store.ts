import { randomBytes } from "node:crypto";
import type { CicilanPayload } from "../../domains/cicilan/cicilan.schema.js";

export const CICILAN_CALLBACK_CONFIRM_PREFIX = "cicilan_confirm:";
export const CICILAN_CALLBACK_REJECT_PREFIX = "cicilan_reject:";
export const CICILAN_CALLBACK_METHOD_PREFIX = "cicilan_method:";

const CALLBACK_DATA_PAYLOAD_PATTERN = /^callback_data:\s*(.+)$/i;
const TOKEN_SANITIZE_PATTERN = /[^A-Za-z0-9_-]/g;
const CICILAN_CONFIRM_COMMAND_PATTERN = /^\/cicilan_confirm\s+([A-Za-z0-9_-]+)$/i;
const CICILAN_REJECT_COMMAND_PATTERN = /^\/cicilan_reject\s+([A-Za-z0-9_-]+)$/i;
const CICILAN_METHOD_COMMAND_PATTERN = /^\/cicilan_method\s+([A-Za-z0-9_-]+)\s+([a-z0-9-]+)$/i;

export type CicilanConfirmationAction =
  | {
      token: string;
      decision: "confirm" | "reject";
    }
  | {
      token: string;
      decision: "method";
      paymentMethod: string;
    };

export type PendingCicilanConfirmation = {
  token: string;
  payload: CicilanPayload;
  createdAtMs: number;
};

const pendingConfirmations = new Map<string, PendingCicilanConfirmation>();

export function parseCicilanConfirmationAction(text: string): CicilanConfirmationAction | null {
  const normalized = text.trim();
  const callbackMatch = normalized.match(CALLBACK_DATA_PAYLOAD_PATTERN);
  const candidate = callbackMatch?.[1]?.trim() ?? normalized;

  if (candidate.startsWith(CICILAN_CALLBACK_CONFIRM_PREFIX)) {
    return {
      decision: "confirm",
      token: candidate.slice(CICILAN_CALLBACK_CONFIRM_PREFIX.length)
    };
  }
  if (candidate.startsWith(CICILAN_CALLBACK_REJECT_PREFIX)) {
    return {
      decision: "reject",
      token: candidate.slice(CICILAN_CALLBACK_REJECT_PREFIX.length)
    };
  }
  if (candidate.startsWith(CICILAN_CALLBACK_METHOD_PREFIX)) {
    return parseMethodCallbackPayload(candidate);
  }

  const confirmMatch = normalized.match(CICILAN_CONFIRM_COMMAND_PATTERN);
  if (confirmMatch?.[1]) {
    return {
      decision: "confirm",
      token: confirmMatch[1]
    };
  }

  const rejectMatch = normalized.match(CICILAN_REJECT_COMMAND_PATTERN);
  if (rejectMatch?.[1]) {
    return {
      decision: "reject",
      token: rejectMatch[1]
    };
  }

  const methodMatch = normalized.match(CICILAN_METHOD_COMMAND_PATTERN);
  if (methodMatch?.[1] && methodMatch[2]) {
    return {
      decision: "method",
      token: methodMatch[1],
      paymentMethod: methodMatch[2].toLowerCase()
    };
  }

  return null;
}

function parseMethodCallbackPayload(payload: string): CicilanConfirmationAction | null {
  const rest = payload.slice(CICILAN_CALLBACK_METHOD_PREFIX.length);
  const separatorIndex = rest.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === rest.length - 1) return null;

  return {
    decision: "method",
    token: rest.slice(0, separatorIndex),
    paymentMethod: rest.slice(separatorIndex + 1).toLowerCase()
  };
}

export function prunePendingCicilanConfirmations(ttlMs: number, nowMs: number = Date.now()): void {
  for (const [token, pending] of pendingConfirmations.entries()) {
    if (nowMs - pending.createdAtMs > ttlMs) {
      pendingConfirmations.delete(token);
    }
  }
}

function createConfirmationToken(): string {
  const rand = randomBytes(8).toString("base64url").replace(TOKEN_SANITIZE_PATTERN, "");
  return rand.slice(0, 12) || `${Date.now().toString(36)}`;
}

export function savePendingCicilanConfirmation(payload: CicilanPayload, ttlMs: number): string {
  prunePendingCicilanConfirmations(ttlMs);

  let token = createConfirmationToken();
  while (pendingConfirmations.has(token)) {
    token = createConfirmationToken();
  }

  pendingConfirmations.set(token, {
    token,
    payload,
    createdAtMs: Date.now()
  });

  return token;
}

export function getPendingCicilanConfirmation(token: string): PendingCicilanConfirmation | undefined {
  return pendingConfirmations.get(token);
}

export function deletePendingCicilanConfirmation(token: string): void {
  pendingConfirmations.delete(token);
}
