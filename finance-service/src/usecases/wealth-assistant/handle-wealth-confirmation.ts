import { env } from "../../config/env.js";
import { formatWealthFailureMessage } from "../../domains/wealth/wealth-formatting.js";
import { isWealthPlatform, normalizeWealthAssetType } from "../../domains/wealth/wealth-platform.js";
import type { WealthSnapshotPayload } from "../../domains/wealth/wealth.schema.js";
import { appendWealthSnapshotRawRow } from "../../integrations/google-sheets/append_wealth_snapshot_row.js";
import { ensureWealthBreakdownFormulas } from "../../integrations/google-sheets/ensure_wealth_breakdown_formula.js";
import type { WealthConfirmationAction } from "./wealth-confirmation-store.js";
import {
  deletePendingWealthConfirmation,
  getPendingWealthConfirmation,
  prunePendingWealthConfirmations
} from "./wealth-confirmation-store.js";

export type WealthConfirmationResult = {
  handled: boolean;
  message?: string;
};

export async function handleWealthConfirmation(
  action: WealthConfirmationAction
): Promise<WealthConfirmationResult> {
  prunePendingWealthConfirmations(env.RECEIPT_CONFIRMATION_TTL_MS);

  const pending = getPendingWealthConfirmation(action.token);
  if (!pending) {
    return {
      handled: true,
      message: "Wealth confirmation token is missing or expired. Re-send the text or statement to parse again."
    };
  }

  if (action.decision === "reject") {
    deletePendingWealthConfirmation(action.token);
    return {
      handled: true,
      message: "No changes made. Wealth snapshot was not saved."
    };
  }

  if (action.decision === "platform" && !isWealthPlatform(action.platform)) {
    return {
      handled: true,
      message: `Unknown wealth platform: ${action.platform}. Choose one of the listed buttons.`
    };
  }

  const payload =
    action.decision === "platform"
      ? withPlatform(pending.payload, action.platform)
      : pending.payload;

  if (action.decision === "confirm" && !payload.platform) {
    return {
      handled: true,
      message: "Choose a platform first, or tap No to reject this wealth snapshot."
    };
  }

  try {
    const result = await appendWealthSnapshotRawRow(payload);
    await ensureWealthBreakdownFormulas();
    deletePendingWealthConfirmation(action.token);

    return {
      handled: true,
      message:
        result === "duplicate"
          ? `Already recorded in ${env.WEALTH_SHEET_RAW}.`
          : `Saved to ${env.WEALTH_SHEET_RAW}.`
    };
  } catch (error) {
    return {
      handled: true,
      message: formatWealthFailureMessage(error)
    };
  }
}

function withPlatform(payload: WealthSnapshotPayload, platform: string): WealthSnapshotPayload {
  return {
    ...payload,
    platform,
    account_name: payload.account_name || platform,
    asset_type: normalizeWealthAssetType(payload.asset_type, platform),
    raw_json: {
      ...payload.raw_json,
      platform_source: "button",
      platform_selected: platform
    }
  };
}
