# Finance API and MCP

This change adds a Finance intake boundary for structured receipt data. It does not create a ChatGPT plugin, replace Google Sheets, or add another database. The existing SQLite receipt table remains canonical and the current Sheet-sync worker remains responsible for the asynchronous mirror.

## Module and request flow

```text
OpenClaw Telegram confirmation ─┐
REST client ────────────────────┼─> FinanceApplication
MCP client (for example ChatGPT)┘      │ validate / preview / idempotency
                                      v
                             saveConfirmedReceipt
                                      │
                     ┌────────────────┴────────────────┐
                     v                                 v
           SQLite receipts table                 optional journal
           (canonical; Sheets outbox)             (existing behavior)
                     │
                     v
           finance-sheet-sync worker
                     │
                     v
             Google Sheets mirror
```

The REST and MCP adapters call the same `FinanceApplication`; neither writes directly to Google Sheets. The OpenClaw receipt confirmation handler now calls that same facade, so the existing Telegram confirmation UX is retained. The facade deliberately reuses the existing receipt writer and schema in this first version rather than moving the Sheet worker or digest reporting into a new service.

| Code location | Responsibility |
|---|---|
| `src/modules/finance/application/finance-application.ts` | Shared validation, preview, deterministic receipt ID, explicit record confirmation, and the injected persistence port |
| `src/modules/finance/finance-runtime.ts` | Runtime composition: configured payment methods plus the existing canonical receipt writer |
| `src/modules/finance/adapters/http/finance-http-server.ts` | Four HTTP routes, bearer-token gate, JSON body limits, and MCP HTTP mounting |
| `src/modules/finance/adapters/mcp/finance-mcp-server.ts` | MCP server identity, JSON Schemas derived from the shared Zod contract, and the three tool handlers |
| `src/scripts/finance_api_server.ts` | Opt-in API/MCP process and graceful shutdown |
| `src/scripts/run_gateway_with_finance_api.ts` | Starts the optional Finance API beside OpenClaw and supervises both child processes |
| `src/usecases/receipt-assistant/save-confirmed-receipt.ts` | Existing SQLite + optional journal + asynchronous Sheets-queue persistence reused by the Finance runtime |

The API server is an opt-in child process supervised alongside the OpenClaw gateway in the same `gateway` container. The existing `finance-sheet-sync` container stays separate and shares the `finance-data` volume. SQLite uses WAL mode, `synchronous=FULL`, and a 5-second busy timeout for the current multi-process access pattern. If the API or gateway child exits, the supervisor stops the other child too.

## Exact surface area

There are four HTTP routes (three require bearer authentication), one MCP endpoint, and three MCP tools:

| Surface | Method | Path/name | Authentication | Effect |
|---|---|---|---|---|
| HTTP | GET | `/healthz` | None | Liveness only; does not test SQLite or Google access |
| HTTP | GET | `/api/v1/finance/payment-methods` | Bearer | Lists configured valid payment method values |
| HTTP | POST | `/api/v1/finance/receipts/preview` | Bearer | Validates and normalizes; never persists |
| HTTP | POST | `/api/v1/finance/receipts` | Bearer | Persists only with `user_confirmed: true` |
| MCP | Streamable HTTP | `/mcp` | Bearer | MCP protocol endpoint; exposes the tools below |
| MCP tool | — | `list_finance_payment_methods` | Bearer on `/mcp` | Lists configured payment methods |
| MCP tool | — | `preview_finance_receipt` | Bearer on `/mcp` | Same no-write preview operation |
| MCP tool | — | `record_finance_receipt` | Bearer on `/mcp` | Same confirmed-write operation; marked destructive |

The HTTP request schema is also maintained in [finance-api.openapi.yaml](./finance-api.openapi.yaml). MCP advertises the equivalent JSON Schema; the application re-validates every write before persistence.

## Request contract

The preview and record operations accept these fields:

| Field | Type | Required | Rules |
|---|---|---:|---|
| `idempotency_key` | string | Yes | 8–128 characters; use a new UUID per receipt and reuse it on retries |
| `merchant_name` | string | Yes | Trimmed; 1–160 characters |
| `receipt_date` | string | Yes | Real calendar date in `YYYY-MM-DD` |
| `total_amount` | number | Yes | Finite and nonnegative, in the stated currency's minor/major unit convention already used by receipts (IDR numeric amount) |
| `tax_amount` | number | No | Finite and nonnegative; defaults to `0` |
| `payment_method` | string | Yes | Must exactly match a configured value returned by the payment-methods route/tool |
| `tax_label_raw` | string | No | At most 120 characters; defaults to empty string |
| `classification` | string | Yes | `food`, `mobility`, `groceries`, `nonfood`, `subscription`, or `income` |
| `currency` | string | No | Three uppercase letters; defaults to `IDR` |
| `confidence` | number | Yes | Finite value from `0` to `1` |

Record adds the required field `user_confirmed: true`. The API rejects unknown fields. MCP advertises `additionalProperties: false` and the Finance application validates the receipt fields again.

Example preview request:

```json
{
  "idempotency_key": "demo-id-1",
  "merchant_name": "Kopi Pagi",
  "receipt_date": "2026-10-17",
  "total_amount": 42000,
  "tax_amount": 3780,
  "payment_method": "db-bca",
  "tax_label_raw": "PB1",
  "classification": "food",
  "currency": "IDR",
  "confidence": 0.97
}
```

Example record request is the same object plus:

```json
{ "user_confirmed": true }
```

The client should show the preview and obtain the user's approval before sending the record request. `user_confirmed` is an explicit client attestation, not cryptographic proof that a human approved it; any holder of the shared bearer token can make a record request. The MCP tool is marked destructive to support approval prompts in compatible clients, but clients must still be configured to require approval.

## Generated fields and persistence response

The server generates `receipt_id`, `source.platform`, `source.chat_id`, `source.message_id`, `source.received_at`, `month_key`, and `needs_review`. The receipt ID is `external:` plus SHA-256 of the idempotency key, so HTTP and MCP retries resolve to the same SQLite key. The raw idempotency key is not stored in the receipt payload. `needs_review` is set when confidence is below `0.8`.

Preview returns the normalized receipt summary and `writes_data: false`. A new record returns HTTP `201`; an idempotent repeat returns `200` with `storage_status: "duplicate"`. The response includes `sheet_sync_status` and `journal_status`. `sheet_sync_status: "queued"` is the normal result when the Sheet mirror is enabled; the worker writes it later. `partial: true` means SQLite succeeded but an enabled secondary sink failed. A SQLite failure returns `503` and is not reported as a successful save.

## Local configuration and run

The feature is disabled by default, preserving current OpenClaw-only startup. Add these values to the private local `.env` file; never commit a real token:

```dotenv
FINANCE_API_ENABLED=true
FINANCE_API_TOKEN=<at-least-32-random-characters>
FINANCE_API_PORT=3100
FINANCE_API_BIND_HOST=127.0.0.1
```

Generate a token locally with `openssl rand -hex 32`, then copy the output into the private `.env`. Start the existing gateway command:

```bash
cd openclaw-platform
make gateway
```

When running Compose, the gateway container binds its internal listener on port `3100`; Compose publishes it only on host loopback (`127.0.0.1`, configurable with `FINANCE_API_HOST_PORT`). The API will not listen unless `FINANCE_API_ENABLED=true`. Start the existing Sheet worker as usual so queued rows are mirrored.

### ChatGPT connection boundary

This service uses a fixed shared bearer token. That is useful for local HTTP/MCP clients and is tested here, but it is not enough to make this a supported private ChatGPT connection. OpenAI's current ChatGPT MCP authentication guidance says authenticated MCP servers should use OAuth 2.1 and that ChatGPT cannot present custom API keys. A secure tunnel provides reachability; it does not replace user authentication. Therefore, do not disable auth or expose this write-capable endpoint publicly to make it connect. A supported OAuth provider or OAuth-capable auth proxy must be selected and added before connecting ChatGPT. That decision is intentionally outside this PR; no ChatGPT app/plugin or OAuth server is created.

For a future ChatGPT connection, use the private endpoint `/mcp` through an HTTPS reverse proxy or supported Secure MCP Tunnel, and configure OAuth once an identity provider is chosen. Availability and write-action approval depend on the ChatGPT plan and workspace policy. See [OpenAI's custom MCP connection guidance](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt), [OpenAI's MCP authentication requirements](https://developers.openai.com/plugins/build/auth), and the [MCP TypeScript SDK HTTP serving guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md).

## Manual HTTP smoke test

Set `TOKEN` in the terminal to the same private token used in `.env`:

```bash
export TOKEN='<your-local-finance-api-token>'
curl --fail-with-body http://127.0.0.1:3100/healthz
curl --fail-with-body -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:3100/api/v1/finance/payment-methods
```

Preview first:

```bash
curl --fail-with-body -X POST http://127.0.0.1:3100/api/v1/finance/receipts/preview \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  --data '{"idempotency_key":"demo-id-1","merchant_name":"Kopi Pagi","receipt_date":"2026-10-17","total_amount":42000,"tax_amount":3780,"payment_method":"db-bca","tax_label_raw":"PB1","classification":"food","currency":"IDR","confidence":0.97}'
```

Only after reviewing the preview, record with the same idempotency key and `user_confirmed: true`. Repeating that request should return `storage_status: "duplicate"`, not add another canonical receipt.

## Credential-free tests

Run the focused test:

```bash
cd openclaw-platform
npm run test:finance-api
```

It builds the project and uses an injected in-memory writer plus a temporary loopback HTTP server. It checks public health, bearer auth, payment-method discovery, no-write preview, required confirmation, idempotent retries, and all three MCP tools. It does not import the environment config, require Google credentials, open Google APIs, or persist a receipt.
