# chief-of-staff

Planning and execution workspace for personal assistant projects, starting with
the OpenClaw Telegram/WhatsApp receipt assistant.

## Purpose
This repository is used to:
- capture product and technical decisions in RFC format
- keep implementation planning close to day-to-day notes
- run the OpenClaw-based assistants as independently deployable services

## Current Status
- Two services: `openclaw-gateway/` (channels + agent) and `finance-service/`
  (finance domain, HTTP + MCP). They talk over a private Docker network.
- `openclaw-platform/`, the original all-in-one application, has been deleted.
  It carried a byte-for-byte copy of 45 of `finance-service/`'s 50 source files.
  `finance-service/` is now the single source of truth for finance code.
- `finance-service/` exposes twelve MCP tools: receipt intake, budget status,
  finance digest, installment and wealth preview/confirm, wealth image/PDF
  parsing, the wishlist board, and a model health check.
- See `docs/service-separation.md` for the architecture, what was intentionally
  dropped with the legacy app, and the deployment and decommissioning notes.

## Repository Structure
```text
chief-of-staff/
|-- openclaw-gateway/        # OpenClaw runtime, WhatsApp/Telegram channels
|-- finance-service/         # finance domain, SQLite store, HTTP + MCP, Sheets sync
|   |-- src/
|   |-- config/
|   `-- compose.yml
|-- integrations/            # example MCP client config
|-- docs/
|   |-- service-separation.md
|   `-- whatsapp-conversation-policy.md
|-- openclaw-obsidian-vault/
|   |-- JOURNAL-DRAFT.md
|   `-- rfc-vault/           # RFC-001 .. RFC-007
`-- README.md
```

## Key Documents
- `openclaw-obsidian-vault/rfc-vault/RFC-001-openclaw-telegram-receipt-assistant.md`
  - scope, architecture, schema, project visualization, function
    responsibilities, and Google Sheets mapping
- `docs/service-separation.md` - current service boundaries and deployment
- `docs/whatsapp-conversation-policy.md` - WhatsApp handoff, experimental

## Stack
- Orchestration: OpenClaw (in `openclaw-gateway/`)
- Language: TypeScript, Node 24
- Channels: Telegram, WhatsApp
- Output sinks: SQLite (canonical) and Google Sheets (`receipts_raw`,
  `monthly_breakdown`, and the wealth, cicilan and budget sheets)

## Local checks
```bash
cd finance-service && npm ci && npm test
cd ../openclaw-gateway && npm ci && npm test
```
Both suites run fully offline.

## Notes
- This repo intentionally keeps planning and implementation decisions in one place.
- OpenClaw is installed project-locally (not globally).
