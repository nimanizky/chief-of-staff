import type { WealthSnapshotPayload } from "../../domains/wealth/wealth.schema.js";

export const WEALTH_CALLBACK_CONFIRM_PREFIX = "wealth_confirm:";
export const WEALTH_CALLBACK_REJECT_PREFIX = "wealth_reject:";
export const WEALTH_CALLBACK_PLATFORM_PREFIX = "wealth_platform:";

const WEALTH_CONFIRM_COMMAND_PATTERN = /^\/wealth_confirm\s+([A-Za-z0-9_-]+)$/i;
const WEALTH_REJECT_COMMAND_PATTERN = /^\/wealth_reject\s+([A-Za-z0-9_-]+)$/i;
const WEALTH_PLATFORM_COMMAND_PATTERN = /^\/wealth_platform\s+([A-Za-z0-9_-]+)\s+([a-z0-9_-]+)$/i;

export type PendingWealthConfirmation = {
  payload: WealthSnapshotPayload;
  createdAt: number;
};

export type WealthConfirmationAction =
  | {
      decision: "confirm";
      token: string;
    }
  | {
      decision: "reject";
      token: string;
    }
  | {
      decision: "platform";
      token: string;
      platform: string;
    };

const pendingConfirmations = new Map<string, PendingWealthConfirmation>();

export function parseWealthConfirmationAction(text: string): WealthConfirmationAction | null {
  const normalized = text.trim();
  const candidate = normalized.replace(/^callback_data:\s*/i, "");

  if (candidate.startsWith(WEALTH_CALLBACK_CONFIRM_PREFIX)) {
    return {
      decision: "confirm",
      token: candidate.slice(WEALTH_CALLBACK_CONFIRM_PREFIX.length)
    };
  }
  if (candidate.startsWith(WEALTH_CALLBACK_REJECT_PREFIX)) {
    return {
      decision: "reject",
      token: candidate.slice(WEALTH_CALLBACK_REJECT_PREFIX.length)
    };
  }
  if (candidate.startsWith(WEALTH_CALLBACK_PLATFORM_PREFIX)) {
    return parseWealthPlatformCallback(candidate);
  }

  const confirmMatch = normalized.match(WEALTH_CONFIRM_COMMAND_PATTERN);
  if (confirmMatch) {
    return {
      decision: "confirm",
      token: confirmMatch[1]
    };
  }

  const rejectMatch = normalized.match(WEALTH_REJECT_COMMAND_PATTERN);
  if (rejectMatch) {
    return {
      decision: "reject",
      token: rejectMatch[1]
    };
  }

  const platformMatch = normalized.match(WEALTH_PLATFORM_COMMAND_PATTERN);
  if (platformMatch) {
    return {
      decision: "platform",
      token: platformMatch[1],
      platform: platformMatch[2].toLowerCase()
    };
  }

  return null;
}

export function savePendingWealthConfirmation(payload: WealthSnapshotPayload, ttlMs: number): string {
  prunePendingWealthConfirmations(ttlMs);
  const token = createToken();
  pendingConfirmations.set(token, {
    payload,
    createdAt: Date.now()
  });
  return token;
}

export function getPendingWealthConfirmation(token: string): PendingWealthConfirmation | undefined {
  return pendingConfirmations.get(token);
}

export function deletePendingWealthConfirmation(token: string): void {
  pendingConfirmations.delete(token);
}

export function prunePendingWealthConfirmations(ttlMs: number): void {
  const now = Date.now();
  for (const [token, pending] of pendingConfirmations.entries()) {
    if (now - pending.createdAt > ttlMs) {
      pendingConfirmations.delete(token);
    }
  }
}

function parseWealthPlatformCallback(payload: string): WealthConfirmationAction | null {
  const rest = payload.slice(WEALTH_CALLBACK_PLATFORM_PREFIX.length);
  const separatorIndex = rest.indexOf(":");
  if (separatorIndex <= 0) return null;
  return {
    decision: "platform",
    token: rest.slice(0, separatorIndex),
    platform: rest.slice(separatorIndex + 1).toLowerCase()
  };
}

function createToken(): string {
  return Math.random().toString(36).slice(2, 10);
}
