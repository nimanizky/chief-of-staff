# openclaw-platform (M1 executable, OpenClaw-first)

Local implementation for RFC-001:
- Telegram receipt intake (media-first flow; `/receipt` remains optional)
- Mistral extraction (`mistral-small-latest`)
- `receipt.v1.1` validation
- SQLite canonical storage with an asynchronous Google Sheets mirror to `receipts_raw`
- `monthly_breakdown` formula bootstrap after each successful sheet sync

## Local-first OpenClaw

This project is set up to prefer a project-local OpenClaw binary.

- Primary launcher: `scripts/openclaw-local.sh`
- Make targets call that launcher
- `OPENCLAW_HOME` defaults to `openclaw-platform/.openclaw-home`
- Global OpenClaw is only used if `OPENCLAW_ALLOW_GLOBAL=1` is set

`openclaw` is pinned in this repo (`openclaw@2026.10.4`) and installed via `npm install`.

## Step-by-step (Local Telegram end-to-end)

## 1) Install host runtime (one-time, macOS)

```bash
cd openclaw-platform
make install-host
make colima-up
make docker-check
```

## 2) Install app deps and env

```bash
cd openclaw-platform
make install
cp .env.example .env
```

Fill `.env` values:
- `GEMINI_API_KEY` when `config/providers.json` uses `"defaultProvider": "google"`
- `MISTRAL_API_KEY` when `config/providers.json` uses `"defaultProvider": "mistral"`
- `TELEGRAM_BOT_TOKEN`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `RECEIPT_SPREADSHEET_ID`
- `RECEIPT_SHEET_RAW`
- `RECEIPT_SHEET_MONTHLY`
- `FINANCE_WEEKLY_SPEND_SHEET` (default `cc_weekly_spend`)
- `FINANCE_PAYMENT_CALENDAR_SHEET` (default `cc_payment_calendar`)
- `FINANCE_DIGEST_ENABLED` (`false` until manual output is verified)
- `FINANCE_DIGEST_TIMEZONE` (default `Asia/Jakarta`)
- `FINANCE_DIGEST_LOOKAHEAD_DAYS` (default `14`)
- `FINANCE_DIGEST_TELEGRAM_CHAT_ID` (required only for scheduled/direct delivery)
- `RECEIPT_MAX_PDF_PAGES` (default `3`)
- `RECEIPT_ACCEPT_PDF` (`false` = image-first mode, keep PDF code path but disable intake)
- `RECEIPT_STRICT_MEMORY_ONLY` (`true` = image-only strict in-memory mode)
- `RECEIPT_PAYMENT_METHODS` (ordered picker values; default `cc-bca,db-bca,cc-bri,db-jago,db-cash,bca,cc-jenius,cash`)
- `RECEIPT_PAYMENT_METHOD_ALIASES` (specific phrases that auto-select a method)
- `RECEIPT_PAYMENT_AMBIGUOUS_ALIASES` (generic phrases like `bca` that show the picker)
- `OPENCLAW_MEMORY_VAULT_PATH` (absolute path to the Obsidian memory vault repo)
- `OPENCLAW_MEMORY_GIT_AUTO_COMMIT` (`true` = commit memory file changes after writes)
- `OPENCLAW_MEMORY_GIT_AUTO_PUSH` (`true` = push memory commits to the vault remote after commit)
- `RECEIPT_JOURNAL_PATH` (recommended: `<vault>/memory/receipts/receipt-journal.md`)
- `FINANCE_SQLITE_PATH` (default `./data/finance.sqlite`; Docker stores it in a persistent named volume)
- `RECEIPT_SHEETS_SYNC_INTERVAL_MS` (default `30000`; background mirror check interval)
- `WISHLIST_FILE_PATH` (optional; defaults to `<vault>/memory/wishlists/backlog-wishlist.md`)
- `WISHLIST_ALLOWED_GROUPS` (comma-separated WhatsApp group ids allowed to edit wishlist memory; `*` allows any WhatsApp group that reaches this task)

Receipt parser provider/model selection lives in `config/providers.json`, not `.env`.

Telegram chat routing lives in `config/channel-routing.json`. For finance-only chats, omit
`general-chat` so media routes directly to receipt parsing and the default OpenClaw agent is suppressed.

## Receipt storage and Google Sheets mirror

A parsed receipt is still only a preview until it is confirmed. On confirmation, OpenClaw writes
one canonical row to SQLite, keyed by `receipt_id`, then queues that row for the Sheets worker.
The first 14 SQLite data columns use the same names and order as `receipts_raw` A:N; additional
SQLite columns retain the original validated payload and track sync attempts. SQLite is the
source of truth; edits made directly in Google Sheets do not sync back into SQLite.

Docker Compose persists the database in its `finance-data` named volume at
`/app/data/finance.sqlite`. The `finance-sheet-sync` service retries queued rows with backoff;
`docker compose down` keeps this volume unless explicitly given `--volumes`/`-v`.
For a non-Docker local gateway, start `make finance-sheets-sync` in a second terminal;
`make docker-up` starts the worker automatically.

Run the offline SQLite test with:

```bash
npm run test:receipt-sqlite
```

The SQLite test uses a temporary database and does not read credentials or call Google APIs.
For a one-off retry of queued sheet rows when running with a configured `.env`, use:

```bash
npm run finance:sheets-sync:once
```

## 3) Prepare Google Sheet

Create tabs:
- `receipts_raw`
- `monthly_breakdown`

In `receipts_raw` row 1, add A:N headers:
`receipt_id,message_id,merchant_name,receipt_date,total_amount,tax_amount,payment_method,classification,currency,confidence,needs_review,tax_label_raw,month_key,raw_json`

Share the sheet with the service-account `client_email` as Editor.

## 4) Ensure OpenClaw CLI is available locally

```bash
make openclaw-version
```

The default path uses `./node_modules/.bin/openclaw` from this project.

## 5) Configure OpenClaw (hooks + Telegram + sandbox defaults)

Use [config/openclaw.config.json](/Users/nurrizky/dev/chief-of-staff/openclaw-platform/config/openclaw.config.json) as baseline.

Important updates before use:
- replace `channels.telegram.allowFrom` placeholder with your numeric Telegram user id
- set absolute path for `hooks.internal.load.extraDirs`

Core fields included in the config:
- internal hook discovery + `task-router` enablement
- Telegram `dmPolicy=allowlist`
- sandbox defaults (`mode=off` for Dockerized VPS gateway deployments)
- sandbox Docker network default `none` (default deny egress)

When the gateway itself runs inside Docker, keep `agents.defaults.sandbox.mode=off`
unless the container also has access to a Docker CLI and Docker socket. Otherwise
general agent replies can fail with `Sandbox mode requires Docker, but the
"docker" command was not found in PATH`.

Then apply and validate:

```bash
make config-validate
make gateway-mode-local
make doctor
make doctor-fix
```

## 6) Configure Telegram in OpenClaw

Set token (`TELEGRAM_BOT_TOKEN`) and pair:

```bash
make telegram-user-id
make pairing-list-telegram
make pairing-approve-telegram PAIR_CODE=<from-list-command>
```

Then set `channels.telegram.allowFrom` to `telegram:<your_numeric_user_id>`.

## 7) Start gateway

```bash
make gateway
```

For a non-Docker local run, start the Sheets mirror worker in a second terminal:

```bash
make finance-sheets-sync
```

In another terminal, follow gateway logs:

```bash
make logs
```

## 8) Test from Telegram

Send receipt media directly to your bot. `/receipt` still works but is optional.

Income mode:
- send `/income` together with the media to classify the row as `income`
- default media without `/income` is treated as a normal receipt

Expected result:
- Telegram first sends parsed fields with `Confirm` / `Cancel` buttons
- `Confirm` writes the canonical row to SQLite and queues it for `receipts_raw`
- The worker appends the Sheet row and retries transient failures automatically
- `monthly_breakdown!A1` formula auto-created if empty

PDF behavior:
- PDF is rasterized via `pdftoppm` (poppler-utils)
- only first `RECEIPT_MAX_PDF_PAGES` pages are processed
- bot includes a note when a PDF is truncated
- image-first mode keeps PDF support in code, but intake is disabled by default unless `RECEIPT_ACCEPT_PDF=true`

Model connectivity check from Telegram:
- send `/modelhealth`
- bot replies with provider, configured model, served model, latency, and success/failure

Finance digest:
- send `/finance` in a chat whose routing policy includes `finance-digest`
- the command reads `cc_weekly_spend`, `cc_payment_calendar`, and current-month quality fields from `receipts_raw`
- the command never writes to Google Sheets and makes no model call

Album behavior:
- multiple media attachments in one message are processed independently
- each media/page gets a deterministic derived `message_id` suffix for idempotency

## Weekly finance digest (RFC-006)

Headers read by the digest:

```text
cc_weekly_spend:
week_start,week_end,payment_method,amount_spent

cc_payment_calendar:
due_date,payment_method,amount_due

receipts_raw quality fields:
receipt_date,payment_method,needs_review
```

The reader resolves columns by header name, so column order may change. Missing or duplicate
required headers fail that source closed instead of guessing a column.

Run deterministic fixture tests:

```bash
cd openclaw-platform
make test-finance
```

Preview live Sheet output in the terminal without sending Telegram and without enabling the schedule:

```bash
make finance-digest-preview
```

Test the task-router path:

```bash
make gateway
```

Then send `/finance` to the configured personal-finance Telegram chat. The chat entry in
`config/channel-routing.json` must include `finance-digest`.

After the preview and `/finance` values match the visible Sheet, enable direct scheduled delivery:

```env
FINANCE_DIGEST_ENABLED=true
FINANCE_DIGEST_TIMEZONE=Asia/Jakarta
FINANCE_DIGEST_LOOKAHEAD_DAYS=14
FINANCE_DIGEST_TELEGRAM_CHAT_ID=your_test_chat_id
```

Send one direct test:

```bash
make finance-digest-send
```

Manual acceptance checklist (use test Sheet tabs and a test Telegram chat first):

1. Keep `FINANCE_DIGEST_ENABLED=false`, run `make finance-digest-preview`, and compare every
   amount and due date with the visible Sheet rows.
2. Send `/finance` in the authorized test chat and confirm it matches the terminal preview.
3. Test empty weekly-spend and payment-calendar tabs; the message must report no spend, a
   `Rp0` reserve, and no upcoming payments.
4. Remove one required header from a test tab; the digest must show a partial-data warning and
   must not guess a replacement column.
5. Compare Google Sheets version history before and after preview and `/finance`; there must be
   no revision created by the digest.
6. Set `FINANCE_DIGEST_ENABLED=true` and the test chat ID, run `make finance-digest-send`, and
   confirm exactly one message arrives in the test chat.
7. Run the cron command once in a short test window, confirm one delivery, then restore the
   intended Monday 08:00 schedule before enabling the production chat.

For a local/VPS host deployment, install this crontab entry with the real repository path:

```cron
0 8 * * 1 cd /absolute/path/to/chief-of-staff/openclaw-platform && ./scripts/run-finance-digest.sh >> /tmp/openclaw-finance-digest.log 2>&1
```

For the Docker deployment, run the already-built deterministic sender in the gateway container:

```cron
0 8 * * 1 cd /absolute/path/to/chief-of-staff/openclaw-platform && docker compose exec -T gateway npm run finance:digest:send >> /tmp/openclaw-finance-digest.log 2>&1
```

The host scheduler supplies Monday 08:00. `FINANCE_DIGEST_TIMEZONE` controls date selection and
formatting inside the digest; configure the host's cron timezone accordingly if it is not already
`Asia/Jakarta`.

## Media privacy (avoid saving pictures)

- For photos/images, this pipeline fetches media into memory and sends it to the model directly.
- No image files are written into the project workspace.
- If you want strict image-only behavior (no PDF temp conversion path), set:

```bash
RECEIPT_STRICT_MEMORY_ONLY=true
```

- With `RECEIPT_STRICT_MEMORY_ONLY=true`, PDFs are rejected and only image/photo input is accepted.

## Obsidian memory vault

OpenClaw memory notes should live under the Obsidian vault's `memory/` folder:

```text
openclaw-obsidian-vault/
`-- memory/
    |-- inbox/
    |-- daily/
    |-- people/
    |-- projects/
    |-- receipts/
    |-- decisions/
    `-- system/
```

For receipt journaling, point `RECEIPT_JOURNAL_PATH` at `memory/receipts/receipt-journal.md`.
Git automation is off by default. Set `OPENCLAW_MEMORY_GIT_AUTO_COMMIT=true` to commit
successful memory writes in the vault repo. Set `OPENCLAW_MEMORY_GIT_AUTO_PUSH=true` only
when you also want those commits pushed to the vault remote.

Wishlist memory lives at `memory/wishlists/backlog-wishlist.md` by default. The
`wishlist-assistant` task is deterministic and is intended for the WhatsApp
Backlog/Wishlist group only. With the group configured as `requireMention=true`,
trigger it by natively mentioning the bot in WhatsApp and sending commands:

```text
show ykc
show ykc activity
show jkt june
show bali food
add ykc local food: rumah makan godean, godean
add jkt june w2: rumah makan godean
add bandung food: batagor kingsley
done ykc rumah makan godean
undone ykc rumah makan godean
```

Pasting a full block that starts with a board title such as `YKC WISHLIST`,
`!!! JKT WISHLIST !!!`, or `FRIENDSHIP BACKLOG` imports/upserts that board.
Pending lines stay plain text; done lines are normalized to `DN item`. Wishlist
writes use path-specific git commits so unrelated staged vault files are not
included.

Board keys are dynamic. The first word after `show`, `add`, `done`, or `undone`
is the board key. Existing headings like `# FRIENDSHIP BACKLOG` can be addressed
as `friendship`; new keys like `bandung` create headings like
`# BANDUNG WISHLIST`.

## Docker + Colima (RFC parity path)

## 1) Start Colima + Docker

```bash
make colima-up
make docker-check
```

## 2) Build and run gateway container

```bash
make docker-build
make docker-up
make docker-logs
```

Files:
- [Dockerfile](/Users/nurrizky/dev/chief-of-staff/openclaw-platform/Dockerfile)
- [docker-compose.yml](/Users/nurrizky/dev/chief-of-staff/openclaw-platform/docker-compose.yml)

## VPS operations

The VPS runs native Linux Docker, not Colima. Colima is only for local macOS development.

SSH into the VPS and enter the deploy directory:

```bash
ssh contabo-openclaw-2
cd /opt/openclaw-platform
```

Check whether the gateway container is running:

```bash
docker compose ps
```

Watch live logs:

```bash
docker compose logs -f gateway
```

Watch the SQLite-to-Sheets mirror worker:

```bash
docker compose logs -f finance-sheet-sync
```

Show recent logs:

```bash
docker compose logs --tail=150 gateway
```

Restart the app:

```bash
docker compose restart gateway
```

Restart both finance services:

```bash
docker compose restart gateway finance-sheet-sync
```

Stop the app:

```bash
docker compose down
```

Start the app:

```bash
docker compose up -d gateway finance-sheet-sync
```

Rebuild after code changes:

```bash
docker compose build gateway
docker compose up -d gateway finance-sheet-sync
```

Enter the container shell:

```bash
docker compose exec gateway bash
```

Inside the container, useful OpenClaw checks:

```bash
make status
make health
make logs
```

Telegram conflict check:

```bash
docker compose logs --tail=200 gateway | grep -i "telegram\|error\|conflict\|failed"
```

If logs show `409 Conflict`, another process is using the same Telegram bot token. Stop the
other bot instance, then restart the VPS gateway:

```bash
docker compose restart gateway
```

## Sandbox mode + egress controls

Sandbox mode helpers:

```bash
make sandbox-enable
make sandbox-disable
make sandbox-explain
make sandbox-recreate
```

Sandbox Docker network helpers:

```bash
make sandbox-network-none
make sandbox-network-bridge
make sandbox-network-custom SANDBOX_DOCKER_NETWORK=<network-name>
```

Egress baseline allowlist domains are tracked in:
- [config/sandbox-egress-allowlist.txt](/Users/nurrizky/dev/chief-of-staff/openclaw-platform/config/sandbox-egress-allowlist.txt)

Print current list:

```bash
make sandbox-egress-allowlist
```

## Parity checklist tooling

Compare baseline vs sandbox extracted outputs (JSON files you generate from your runs):

```bash
make parity-compare BASELINE=./baseline.json SANDBOX=./sandbox.json
```

Script:
- [compare_parity_results.ts](/Users/nurrizky/dev/chief-of-staff/openclaw-platform/src/scripts/compare_parity_results.ts)

## Backfill tooling

Run historical receipts into the same pipeline:

```bash
make backfill INPUT=./backfill.json
```

Script:
- [backfill_receipts.ts](/Users/nurrizky/dev/chief-of-staff/openclaw-platform/src/scripts/backfill_receipts.ts)

## Utility targets

```bash
make help
make validate-schema
make status
make health
make doctor
make doctor-fix
make gateway-mode-local
make security-audit
make onboard
```
