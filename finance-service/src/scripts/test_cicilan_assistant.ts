import "./offline-test-env.js";
import assert from "node:assert/strict";
import { buildCicilanPayload } from "../domains/cicilan/cicilan-parser.js";
import { projectedMonthlyAmount } from "../domains/cicilan/cicilan-formatting.js";
import { parseCicilanConfirmationAction } from "../usecases/cicilan-assistant/cicilan-confirmation-store.js";

const baseInput = {
  sourcePlatform: "telegram",
  chatId: "380399260",
  messageId: "500",
  receivedAt: "2026-07-02T17:00:00.000Z"
};

{
  const payload = buildCicilanPayload({
    ...baseInput,
    text: "cicilan cc bca anytime fitness 5999k 12 kali 0%"
  });
  assert.equal(payload.merchant_name, "anytime fitness");
  assert.equal(payload.total_amount, 5_999_000);
  assert.equal(payload.tenor_months, 12);
  assert.equal(projectedMonthlyAmount(payload), 499_917);
  assert.equal(payload.payment_method, "cc-bca");
  assert.equal(payload.month_key, "2026-07");
  assert.equal(payload.raw_json.interest_rate_raw, "0%");
  assert.equal(payload.raw_json.interest_defaulted, false);
}

{
  const payload = buildCicilanPayload({
    ...baseInput,
    messageId: "501",
    text: "cicil cc jenius uniqlo 5,090,234 12 bulan"
  });
  assert.equal(payload.merchant_name, "uniqlo");
  assert.equal(payload.total_amount, 5_090_234);
  assert.equal(payload.tenor_months, 12);
  assert.equal(payload.payment_method, "cc-jenius");
  assert.equal(payload.raw_json.interest_rate_raw, "0%");
  assert.equal(payload.raw_json.interest_defaulted, true);
}

{
  const payload = buildCicilanPayload({
    ...baseInput,
    messageId: "502",
    text: "cicil cc shopee pay later or spl or spaylter uniqlo 5,090,234 12x"
  });
  assert.equal(payload.merchant_name, "uniqlo");
  assert.equal(payload.payment_method, "spaylater");
  assert.equal(payload.tenor_months, 12);
}

{
  const payload = buildCicilanPayload({
    ...baseInput,
    messageId: "503",
    text: "cicil cash coffee machine 2500000"
  });
  assert.equal(payload.tenor_months, 1);
  assert.equal(payload.raw_json.tenor_defaulted, true);
  assert.equal(projectedMonthlyAmount(payload), 2_500_000);
}

assert.deepEqual(parseCicilanConfirmationAction("cicilan_confirm:abc123"), {
  decision: "confirm",
  token: "abc123"
});
assert.deepEqual(parseCicilanConfirmationAction("callback_data: cicilan_method:abc123:cc-bca"), {
  decision: "method",
  token: "abc123",
  paymentMethod: "cc-bca"
});

console.log("cicilan assistant tests passed");
