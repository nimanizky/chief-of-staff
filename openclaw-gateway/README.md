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

Useful checks:

```bash
docker compose ps -a
docker compose logs workspace-migrate
docker volume ls
docker compose exec gateway sh -lc 'printf "workspace=%s\\n" "$OPENCLAW_WORKSPACE_DIR"; ls -la /workspace'
```

Run `npm ci && npm test` for bootstrap and migration tests. A model, channel
authorization, and WhatsApp/Telegram connections still need setup or a tested
state migration. The browser uses an authenticated private network and does
not mount gateway state or finance credentials. Browserless sessions may be
ephemeral; persistent site login and interactive authentication have not yet
been validated. See [service separation](../docs/service-separation.md) before
any deployment, browser login, or cutover from the legacy gateway.
