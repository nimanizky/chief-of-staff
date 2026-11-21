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

The finance MCP surface has nine tools covering receipt intake, budget status,
finance digest, and text-based installment and wealth preview/confirmation.
Installment and wealth confirmation tokens are in-memory and expire or are lost
when the service restarts; their confirmed writes still use Google Sheets.
Wealth image/PDF parsing and scheduled reminder delivery are not yet exposed.
The old application under
`openclaw-platform/` is retained as legacy source; finance code is duplicated
there and in `finance-service/`. The new services use separate volumes and do
not import the legacy data. Do not point two sync workers at copied data: they
could both write the same transactions to Google Sheets.

## Local checks

```bash
cd finance-service
npm ci
npm test
cd ../openclaw-gateway
npm ci
npm test
```

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

The old automatic tag creation workflow is now manually dispatched to prevent
changes in the retained legacy application from automatically deploying the old
stack. Its existing tag deployment workflow remains available for explicit tags.

## Starting fresh

No automatic data or session migration is configured. New volumes start empty;
existing SQLite receipts and WhatsApp sessions stay in the legacy volumes.
After deployment, link WhatsApp again and configure the model, Telegram and
integrations. Do not infer that those connections or Google Sheets work until
they have been tested on the server.
