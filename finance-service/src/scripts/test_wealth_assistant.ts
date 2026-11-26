import assert from "node:assert/strict";
import { buildWealthSnapshotFromText } from "../domains/wealth/wealth-parser.js";
import { parseWealthConfirmationAction } from "../usecases/wealth-assistant/wealth-confirmation-store.js";

const baseInput = {
  sourcePlatform: "telegram",
  chatId: "380399260",
  messageId: "700",
  receivedAt: "2026-07-04T05:00:00.000Z"
};

{
  const payload = buildWealthSnapshotFromText({
    ...baseInput,
    text: "wealth jago 15.2jt cash"
  });
  assert.equal(payload.platform, "jago");
  assert.equal(payload.asset_type, "cash");
  assert.equal(payload.amount, 15_200_000);
  assert.equal(payload.month_key, "2026-07");
  assert.equal(payload.source_type, "text");
}

{
  const payload = buildWealthSnapshotFromText({
    ...baseInput,
    messageId: "701",
    text: "wealth stockbit 42.5jt saham"
  });
  assert.equal(payload.platform, "stockbit");
  assert.equal(payload.asset_type, "stocks");
  assert.equal(payload.amount, 42_500_000);
}

{
  const payload = buildWealthSnapshotFromText({
    ...baseInput,
    messageId: "702",
    text: "wealth bibit 18,200,000 reksadana"
  });
  assert.equal(payload.platform, "bibit");
  assert.equal(payload.asset_type, "mutual_fund");
  assert.equal(payload.amount, 18_200_000);
}

assert.deepEqual(parseWealthConfirmationAction("wealth_confirm:abc123"), {
  decision: "confirm",
  token: "abc123"
});
assert.deepEqual(parseWealthConfirmationAction("callback_data: wealth_platform:abc123:stockbit"), {
  decision: "platform",
  token: "abc123",
  platform: "stockbit"
});

console.log("wealth assistant tests passed");
