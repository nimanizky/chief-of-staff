# OpenClaw gateway

Independent OpenClaw gateway with an isolated Browserless container and the official WhatsApp plugin.
No finance application code or finance database is bundled. On first boot it
creates a generic config in the persistent state directory. An optional generic
external MCP service can be configured using MCP_SERVER_URL and MCP_SERVER_TOKEN;
the separate ChatGPT-facing MCP endpoint described below is disabled by default.

## Persistent state and workspace

The gateway uses two independent Docker named volumes:

- `openclaw-state` at `/home/node/.openclaw`: OpenClaw config, OAuth/provider
  profiles, WhatsApp sessions, agent/session SQLite databases, cron state, and
  other runtime metadata.
- `openclaw-workspace` at `/workspace`: native OpenClaw workspace files,
  including `AGENTS.md`, `USER.md`, `MEMORY.md`, and daily Markdown memory.

The workspace migration service copies the existing
`/home/node/.openclaw/workspace` from `openclaw-state` into
`openclaw-workspace` before the gateway starts. It verifies SHA-256 checksums,
retains the original files in `openclaw-state` for rollback, and records a
migration marker. It never deletes the legacy workspace. If the destination
volume already contains different files, or the old workspace path is custom,
startup stops rather than overwriting data.

A small sentinel in the workspace volume detects an accidentally replaced or
empty workspace volume while the state volume still exists. Do not remove the
sentinel or run `docker compose down -v` unless you intentionally want to
delete both persistent volumes.

For a genuinely new installation with no legacy workspace, set
`OPENCLAW_ALLOW_EMPTY_LEGACY_WORKSPACE=true` in `.env`. Existing deployments
must leave it false.

## Obsidian vault synchronization

The `memory-sync` sidecar synchronizes the persistent workspace with the private
repository `nimanizky/openclaw-obsidian-vault`. It runs on the VPS; your laptop
does not need to stay online.

The sidecar is intentionally separate from the gateway and mounts only the
workspace volume plus a read-only secrets directory. It never mounts
`openclaw-state`. The one-shot `memory-sync-init` service attempts the initial
vault clone/merge before the gateway starts. If the key is not configured or
GitHub is temporarily unavailable, the gateway still starts with local
persistent memory and the background worker retries.

The worker uses Git over SSH and pins GitHub's published Ed25519 host key. It
never force-pushes or resets the workspace.

### Manual sync from GitHub Actions

After the workflow is merged into `main`, open **Actions → OpenClaw to Obsidian
manual sync**, select `main`, confirm the checkbox, and select **Run workflow**.
The workflow connects to the VPS and asks the already-running `memory-sync`
container to run the same `sync.mjs sync` command. It does not upload or
download workspace files through GitHub Actions.

ChatGPT can trigger that exact same workflow through the MCP
`workspace_sync` tool. In other words, the GitHub button and the ChatGPT tool
are two entry points to one server-side sync operation. The automatic worker
continues to poll at `MEMORY_SYNC_INTERVAL_SECONDS` (60 seconds by default);
manual requests do not disable it. A lock in the sync engine prevents the
background worker and an on-demand request from running Git operations at the
same time.

The current GitHub workflow is manual-only. A GitHub Actions `schedule` trigger
can be added to this same workflow later if a calendar-based cadence is wanted;
it will reuse the same VPS command and sync engine.

### One-time GitHub setup

1. Generate a dedicated Ed25519 key pair:
   `ssh-keygen -t ed25519 -C "openclaw-obsidian-vault-sync" -f ~/.ssh/openclaw-obsidian-vault-sync -N ""`
2. Add the contents of `openclaw-obsidian-vault-sync.pub` to the private
   `openclaw-obsidian-vault` repository under **Settings → Deploy keys** and
   enable **Allow write access**.
3. Add the private key contents as the `OBSIDIAN_VAULT_DEPLOY_KEY` Actions
   secret in `nimanizky/chief-of-staff`.
4. Run the **OpenClaw gateway CI and deployment** workflow. It installs the
   key at `/opt/chief-of-staff/secrets/obsidian-vault-deploy-key` with
   owner-only file permissions. The worker will clone/merge the vault and then
   commit and push workspace changes.

If the secret is not configured, the gateway still runs with local persistent
memory and the sync worker waits for the key. No memory is deleted or reset.

### Sync behavior

- Local workspace changes are committed and pushed to `main`.
- Remote changes are fetched and merged.
- If both sides change the same file, the worker aborts the merge and reports
  the conflict. It does not force-push, reset, or discard either side.
- During the first clone, legacy workspace files take precedence at matching
  paths. Different vault versions are preserved under
  `memory/migration-conflicts/remote-vault/`; local-only files are imported.
- Common secret files, databases, and runtime state are excluded from Git.

### Memory CLI

Run these commands from the VPS project directory:

```bash
./scripts/memory.sh status
./scripts/memory.sh sync
./scripts/memory.sh backup
./scripts/memory.sh restore --commit <commit-sha> --path MEMORY.md
./scripts/memory.sh restore --commit <commit-sha> --path MEMORY.md --apply
```

Restore is a dry-run unless `--apply` is supplied. When applied, the current
Markdown file is copied under `memory/recovery/` before the historical version
is restored and synchronized.

Useful checks:

```bash
docker compose ps -a
docker compose logs workspace-migrate
docker compose logs --tail=100 memory-sync-init
docker compose logs --tail=100 memory-sync
docker volume ls
docker compose exec gateway sh -lc 'printf "workspace=%s\\n" "$OPENCLAW_WORKSPACE_DIR"; ls -la /workspace'
```

Run `npm ci && npm test` for bootstrap, migration, and sync-helper tests.
The browser uses an authenticated private network and does not mount gateway
state or finance credentials. Browserless sessions may be ephemeral; persistent
site login and interactive authentication have not yet been validated. See
[service separation](../docs/service-separation.md) before any deployment,
browser login, or cutover from the legacy gateway.

## ChatGPT-facing MCP endpoint

The gateway can optionally expose a remote, Streamable HTTP MCP server for ChatGPT and other MCP clients. It runs in the same container as the Gateway so it can call the local OpenClaw CLI and access the same persistent /workspace volume without copying WhatsApp credentials or Gateway state into another container.

The endpoint is **disabled by default** and runs as a second process inside the existing `gateway` container. It is not a separate Docker service or container. When enabled, the supervisor waits for the Gateway health check before starting the MCP listener.

Compose binds the MCP listener to `0.0.0.0:3200` inside the container, exposes port 3200 on the private Docker network, and publishes it on the VPS host as `127.0.0.1:${MCP_HOST_PORT:-3200}` only. This lets a reverse proxy running on the VPS host reach MCP without making port 3200 directly accessible from the internet. A reverse-proxy container attached to `chief-of-staff-services` can instead route to `http://gateway:3200`.

To let ChatGPT reach it from outside the VPS, configure a stable public HTTPS hostname and route it through an existing host-level reverse proxy (for example Caddy or Nginx) to `http://127.0.0.1:3200`, or use a secure tunnel such as Cloudflare Tunnel with that same local upstream. For example, a host-level Caddy site can use:

~~~caddyfile
mcp.example.com {
    reverse_proxy 127.0.0.1:3200
}
~~~

Replace `mcp.example.com` with a domain whose DNS points to the VPS (or is routed through the tunnel). The proxy must forward both `/mcp` and `/.well-known/oauth-protected-resource` without rewriting their paths or dropping the `Authorization` header, and terminate valid public TLS. ChatGPT connects to `https://mcp.example.com/mcp`. Do not publish port 3200 or the OpenClaw Gateway port (18789) directly to the public internet. The repository does not currently provision a public reverse proxy, DNS record, tunnel, or OAuth identity provider; those remain deployment configuration.

### Available tools

| Tool | Scope | Purpose |
| --- | --- | --- |
| whatsapp_list_groups | openclaw.read | List WhatsApp group sessions already known to OpenClaw |
| whatsapp_read_group_messages | openclaw.read | Read recent messages from one group's OpenClaw session transcript |
| whatsapp_send_group_message | openclaw.read + openclaw.write | Send a text message to a known WhatsApp group |
| workspace_list_notes | openclaw.read | List Markdown notes in /workspace |
| workspace_read_note | openclaw.read | Read one Markdown note |
| workspace_write_note | openclaw.write | Create a note or explicitly overwrite an existing note |
| workspace_sync | openclaw.write | Trigger an immediate sync through the shared GitHub Actions workflow |

WhatsApp history is read through the Gateway sessions.list and chat.history RPCs. The read tool returns only the transcript content OpenClaw retained for the group session; it is **not** a guaranteed full export of every message in the WhatsApp group. Groups without an existing OpenClaw session are not listed. The send tool only accepts a group JID that is already present in the OpenClaw session list. It is marked as an externally visible write action, and the caller should confirm the exact recipient and message before sending.

Workspace tools operate only on Markdown files under /workspace. They reject absolute paths, traversal, symlinks, hidden/configuration directories, and non-Markdown files. Existing notes are not overwritten unless overwrite=true is explicit. A successful write saves the note locally; the background memory-sync worker commits and pushes changes automatically using MEMORY_SYNC_INTERVAL_SECONDS (default 60 seconds).

The `workspace_sync` tool is the explicit **sync now** action. It dispatches the same GitHub Actions workflow exposed in **Actions → OpenClaw to Obsidian manual sync**. GitHub Actions connects to the VPS over SSH and runs the existing memory-sync CLI against the persistent workspace. The tool returns when the workflow has been queued, not when the Git push has finished; use the GitHub Actions run for the final result. The background worker continues independently, so this is an additional immediate trigger rather than a replacement for automatic sync.

To enable `workspace_sync`, configure `MCP_SYNC_GITHUB_TOKEN` in the gateway `.env` with a fine-grained GitHub token restricted to `nimanizky/chief-of-staff` and the **Actions: read and write** repository permission. The repository, workflow filename, and target ref default to `nimanizky/chief-of-staff`, `openclaw-obsidian-manual-sync.yml`, and `main`; they can be overridden with `MCP_SYNC_GITHUB_REPOSITORY`, `MCP_SYNC_GITHUB_WORKFLOW`, and `MCP_SYNC_GITHUB_REF`. The token is used only by the MCP server to dispatch the workflow; it is not sent to the VPS or Obsidian vault.

### OAuth and public endpoint setup

The MCP server is a **resource server**, not an OAuth authorization server. Use an established OAuth 2.1 identity provider. The provider must support the MCP authorization-code flow with PKCE S256, refresh tokens, ChatGPT's Client ID Metadata Documents (CIMD) or Dynamic Client Registration (DCR), and the resource parameter. Its authorization-server metadata must advertise S256, the supported token-endpoint authentication methods, and either CIMD support or a registration endpoint. It should set authorization_response_iss_parameter_supported=true and return the exact issuer in the iss parameter on successful and error authorization responses. The provider must issue JWT access tokens with a signing key published through JWKS and an audience/resource claim matching this MCP server.

Configure the following values in the gateway .env file:

~~~dotenv
MCP_SERVER_ENABLED=true
MCP_PORT=3200
MCP_HOST_PORT=3200
MCP_PUBLIC_URL=https://mcp.example.com
MCP_OAUTH_ISSUER=https://your-identity-provider.example/
MCP_OAUTH_JWKS_URL=https://your-identity-provider.example/.well-known/jwks.json
MCP_OAUTH_AUDIENCE=https://mcp.example.com
MCP_OAUTH_ALLOWED_SUBJECT=the-exact-stable-sub-claim-for-your-user
MCP_OAUTH_SCOPE_READ=openclaw.read
MCP_OAUTH_SCOPE_WRITE=openclaw.write
MCP_SYNC_GITHUB_TOKEN=github_pat_replace_me
MCP_SYNC_GITHUB_REPOSITORY=nimanizky/chief-of-staff
MCP_SYNC_GITHUB_WORKFLOW=openclaw-obsidian-manual-sync.yml
MCP_SYNC_GITHUB_REF=main
~~~

MCP_PUBLIC_URL is the public HTTPS **origin**, without /mcp. A host-level reverse proxy routes both https://mcp.example.com/mcp and https://mcp.example.com/.well-known/oauth-protected-resource to http://127.0.0.1:3200. A reverse-proxy container on the private Docker network can instead use http://gateway:3200. Preserve request paths and the Authorization header. The audience/resource value issued by the identity provider must exactly match MCP_PUBLIC_URL. MCP_OAUTH_ISSUER must exactly match the token's iss claim, including any trailing slash. MCP_OAUTH_ALLOWED_SUBJECT is required and restricts this personal server to one stable identity-provider subject. Tokens are checked for signature, issuer, audience, expiry, not-before, and required scopes on every tool call. Supported JWT signature algorithms are RS256, PS256, and ES256.

Compose sets MCP_BIND_HOST=0.0.0.0 inside the container so trusted Docker peers and the host-loopback port mapping can reach it. The published host port is restricted to 127.0.0.1; it is not directly reachable from the internet. Set MCP_HOST_PORT only if 3200 is already occupied on the VPS. Do not expose port 3200 or the OpenClaw Gateway RPC port (18789) publicly. Keep the reverse proxy and OAuth provider configuration private and do not replace OAuth with a static bearer token.

After enabling MCP and configuring OAuth in the VPS .env, redeploy the gateway. Verify locally on the VPS before connecting ChatGPT:

~~~bash
curl -fsS http://127.0.0.1:3200/healthz
curl -fsS https://mcp.example.com/.well-known/oauth-protected-resource
~~~

The first request checks the local MCP process; the second checks public HTTPS routing and protected-resource metadata. A successful health check does not mean OAuth is configured or that ChatGPT has authenticated.

After configuring the provider and reverse proxy, connect ChatGPT to:

~~~text
https://mcp.example.com/mcp
~~~

Choose OAuth authentication in the custom MCP server connection. The server publishes its protected-resource metadata at /.well-known/oauth-protected-resource and declares read/write scopes on each tool. No additional npm dependencies are needed for this MCP endpoint; it uses Node's built-in HTTP, crypto, filesystem, and child-process APIs.
