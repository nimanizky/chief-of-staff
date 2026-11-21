# OpenClaw gateway

Independent OpenClaw gateway with an isolated Browserless container and the official WhatsApp plugin.
No finance application code or finance database is bundled. On first boot it
creates a generic config in the persistent state directory; an optional generic
Streamable HTTP MCP endpoint is configured using `MCP_SERVER_URL` and
`MCP_SERVER_TOKEN`. More servers can be configured through OpenClaw itself.

Run `npm ci && npm test` for bootstrap tests. A model, channel authorization,
and WhatsApp/Telegram connections still need setup or a tested state migration.
The browser uses an authenticated private network and does not mount gateway
state or finance credentials. Browserless sessions may be ephemeral; persistent
site login and interactive authentication have not yet been validated.
See [`docs/service-separation.md`](../docs/service-separation.md) before any
deployment, browser login, or cutover from the legacy gateway.
