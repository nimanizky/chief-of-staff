# Service separation: OpenClaw and finance

## Architecture

The independently built gateway lives in `openclaw-gateway/`. It contains the
upstream OpenClaw runtime, its WhatsApp plugin, and generic bootstrap
configuration. It does not import finance source code or mount the finance
database. WhatsApp and Telegram remain OpenClaw channel responsibilities.

`finance-service/` owns the existing receipt intake application, HTTP/MCP
adapters, SQLite receipt store, and asynchronous Google Sheets sync worker.
Its image does not depend on OpenClaw. The two Compose projects communicate
over the private external `chief-of-staff-services` Docker network. No finance
port is published to the internet. An MCP client connects to
`http://finance:3100/mcp` using the finance bearer token.

The finance MCP surface has twelve tools covering receipt intake, budget status,
finance digest, text-based installment and wealth preview/confirmation, wealth
image/PDF parsing, the wishlist board, and a model health check. Installment and
wealth confirmation tokens are in-memory and expire or are lost when the service
restarts; their confirmed writes still use Google Sheets.

`openclaw-platform/` has been deleted. It held a byte-for-byte copy of 45 of
`finance-service/`'s 50 source files, so a fix had to be applied twice with
nothing to catch a miss. `finance-service/` is now the only place finance code
lives. Scheduled delivery moved with it: `npm run finance:digest:send` and
`npm run budget:send` are the digest and budget-guardrail senders, both opt-in
via `FINANCE_DIGEST_ENABLED` and `BUDGET_ALERT_ENABLED` and no-ops while
disabled. Wire them to cron or a timer on the server; nothing schedules them
automatically.

Two capabilities did not survive the deletion, deliberately:

- The OpenClaw channel-routing layer (`task-router/`, `controllers/`,
  `handlers/`, the `receipt-gate` and `task-gate` plugins and the hook
  pipeline). The gateway owns channel routing now, so its trigger-word
  detection and the tests covering it went with the deleted code.
- `calory-assistant`, which was a stub whose only behaviour was replying
  "Calory assistant is not implemented yet". Nothing was ported. The nutrition
  schema went too; reintroduce both together if the feature is ever built.

Server-side receipt OCR also did not move. In this stack the gateway's own
vision model reads a receipt photo and calls `preview_finance_receipt` with
structured fields, so the Mistral/Gemini receipt-parser adapters were dropped.
Only the wealth path still parses media server-side, because
`parse_finance_wealth_image` handles portfolio screenshots the agent reads
poorly. It needs `MISTRAL_API_KEY`; PDF input additionally needs
`RECEIPT_ACCEPT_PDF=true` and the `pdftoppm` binary, which the image installs
via `poppler-utils`.

## Local checks

```bash
cd finance-service
npm ci
npm test          # 9 suites: sqlite, finance API/MCP, receipt schema,
                  # classification, digest, cicilan, wealth, wishlist, budget
cd ../openclaw-gateway
npm ci
npm test
```

Every suite runs offline. No suite needs Google credentials, a model key or a
network call; `src/scripts/offline-test-env.ts` supplies placeholder values for
the modules that validate the environment when they are imported.

For Docker, create a private Docker network, provision the `.env` files based on
the examples, and configure the gateway channels/model. Set `MCP_SERVER_URL` to
`http://finance:3100/mcp` and `MCP_SERVER_TOKEN` to the finance API bearer token
before the gateway's first start. The bootstrap only writes an initial config
when none exists; subsequent changes to MCP servers use standard OpenClaw config.
On existing configurations, `integrations/finance-mcp.example.json` shows the
equivalent MCP definition. Substitute your own environment variable names.

The example gateway configuration is a starting point, not a working WhatsApp
login: channel allowlists, Telegram token, model provider, gateway authentication,
and WhatsApp session must be configured. Browser sign-in may require an
interactive browser host and manual 2FA. The browser runs in a separate
Browserless container with a separate private network, dropped capabilities,
no host port, a token, and no gateway state or finance credential mounts.
Container isolation does not prove Chrome's internal sandbox is enabled.
Browserless sessions may be ephemeral; persistent login is not yet validated.

## CI and deployment

`.github/workflows/openclaw-gateway.yml` and `finance-service.yml` run separately
on relevant PRs and main changes. Each runs its own checks and builds its image.
They are the only two workflows left: `pr-checks.yml`, `deploy-vps.yml` and
`create-release-tag.yml` covered `openclaw-platform` and were deleted with it,
so no tag can deploy the old stack any more. Decommission the legacy containers
and their volumes on the server by hand; nothing in CI does it.
Deployment can be manually dispatched from `main`; push-to-main deployment is
disabled unless the corresponding repository variable `ENABLE_OPENCLAW_AUTO_DEPLOY`
or `ENABLE_FINANCE_AUTO_DEPLOY` is set to `true`. Configure required reviewers
on the GitHub `production` environment if approval is required; the YAML alone
does not enforce a human approval.

Each deployment needs `VPS_HOST`, `VPS_SSH_KEY`, and `VPS_KNOWN_HOSTS` secrets;
`VPS_USER` and `VPS_PORT` are optional. Provision each service's private `.env`
and the finance Google service-account file on the server before deployment.
The workflows use separate `/opt/chief-of-staff/openclaw-gateway` and
`/opt/chief-of-staff/finance-service` directories. They do not stop legacy
containers. Pair the desired WhatsApp account only with the intended gateway;
do not configure the old and new finance workers to sync the same data.


## Starting fresh

No automatic data or session migration is configured. New volumes start empty;
existing SQLite receipts and WhatsApp sessions stay in the legacy volumes, which
the deletion of `openclaw-platform/` did not touch. Copy anything you still want
off them before you remove those volumes.
After deployment, link WhatsApp again and configure the model, Telegram and
integrations. Do not infer that those connections or Google Sheets work until
they have been tested on the server.
