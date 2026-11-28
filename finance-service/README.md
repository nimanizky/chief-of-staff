# Finance service

Receipt intake, finance tooling and Google Sheets sync for the chief-of-staff
monorepo. It does not require OpenClaw to build or run. Since
`openclaw-platform/` was deleted, this is the only place finance code lives.

The HTTP server exposes `GET /healthz`,
`GET /api/v1/finance/payment-methods`,
`POST /api/v1/finance/receipts/preview`, `POST /api/v1/finance/receipts`, and
Streamable HTTP MCP at `/mcp`. All except health require the bearer token.

## MCP tools

Twelve tools: receipt (list payment methods, preview, record), budget status,
finance digest, installment preview/confirm, wealth preview/confirm, wealth
image/PDF parsing, the wishlist board, and a model health check. Full table and
request contract in [`docs/finance-mcp-api.md`](./docs/finance-mcp-api.md).

Receipt, installment, wealth and wishlist writes require confirmation. Record
requires a `user_confirmed: true` attestation; this is not proof that a human
approved. Installment and wealth confirmation tokens are in memory, so they
expire and do not survive a restart. SQLite is canonical for receipts and the
sheet worker mirrors asynchronously.

`parse_finance_wealth_image` needs `MISTRAL_API_KEY`. PDF input also needs
`RECEIPT_ACCEPT_PDF=true` and the `pdftoppm` binary, which the Docker image
installs via `poppler-utils`. `run_wishlist_command` only accepts WhatsApp chats
listed in `WISHLIST_ALLOWED_GROUPS`.

## Commands

```bash
npm ci
npm test                      # 9 offline suites, no credentials or network
npm start                     # HTTP + MCP server
npm run sync                  # Google Sheets sync worker
npm run finance:digest:preview  # print the digest without sending
npm run finance:digest:send   # needs FINANCE_DIGEST_ENABLED=true
npm run budget:send           # needs BUDGET_ALERT_ENABLED=true
```

The two senders are opt-in and no-op while their flags are false. Nothing
schedules them: wire them to cron or a systemd timer on the server.

Compose setup, independent deployment, what was intentionally dropped with the
legacy app, and data migration limitations are described in
[`docs/service-separation.md`](../docs/service-separation.md).
