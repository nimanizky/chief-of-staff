# OpenClaw gateway

Independent OpenClaw gateway with an isolated Browserless container and the official WhatsApp plugin.
No finance application code or finance database is bundled. On first boot it
creates a generic config in the persistent state directory; an optional generic
Streamable HTTP MCP endpoint is configured using `MCP_SERVER_URL` and
`MCP_SERVER_TOKEN`. More servers can be configured through OpenClaw itself.

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
