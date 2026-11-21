# Finance service

Independent receipt intake and Google Sheets sync for the chief-of-staff
monorepo. It does not require OpenClaw to build or run. The HTTP server exposes
`GET /healthz`, `GET /api/v1/finance/payment-methods`,
`POST /api/v1/finance/receipts/preview`, `POST /api/v1/finance/receipts`, and
Streamable HTTP MCP at `/mcp`. All except health require the bearer token.

The MCP server provides receipt, budget, digest, installment, and wealth tools.
Receipt, installment, and wealth writes require confirmation. Record requires a
`user_confirmed: true` attestation; this is not proof that a human approved.
SQLite is canonical for receipts and the sheet worker mirrors asynchronously.

Run `npm ci && npm test` for credential-free tests. Compose setup, independent
deployment, and important data migration limitations are described in
[`docs/service-separation.md`](../docs/service-separation.md).
