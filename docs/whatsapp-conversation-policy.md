# WhatsApp conversation handoff

Experimental and off by default. Validate on a dedicated test account first.

1. Send a normal WhatsApp DM from the linked phone while the gateway is online.
   The gateway remembers the contact, but takes no action. Their reply is
   visible in the WhatsApp app even if OpenClaw ignores it.
2. In an owner-authenticated WhatsApp DM, say “Take over the conversation with
   restaurant A; ask if a table at 7 pm for four is available.” Provide the
   exact number if OpenClaw cannot resolve it. The model has a dedicated
   handoff tool; the owner does not run a shell command for each conversation.
3. New inbound messages from that contact are eligible for automatic text
   replies during the one-hour handoff. Previously ignored messages are not
   replayed. Ask OpenClaw to stop the handoff to revoke it early.
4. Unknown DMs remain subject to the existing no-pairing allowlist. Keep it
   tight and audit previous pairing grants; groups are unchanged.

## Operator setup (one time)

Use the pinned gateway image built by this PR and the default WhatsApp account.
Keep WhatsApp's effective DM policy at `allowlist` without a wildcard. Enable
`WHATSAPP_HANDOFF_ENABLED=1` and configure `WHATSAPP_HANDOFF_OWNER` privately
in the gateway env. The number must also resolve as owner in OpenClaw, not merely
an allowed sender. Configure `session.dmScope` as `per-channel-peer` or
`per-account-channel-peer`. State is stored under the existing state volume.

## Limits and validation

- The observer accepts fresh, direct, same-account outgoing events and excludes
  OpenClaw's recent outbound echoes plus Baileys-generated IDs. This is an
  ID-format heuristic, not conclusive proof that a message came from a handset
  rather than another linked client. Offline sends are not guaranteed.
- Handoff replies use the existing agent and a tool-blocking hook, not a
  separately sandboxed external agent. Goal instructions are prompt guidance,
  not a hard authorization boundary. Do not enable on an agent with sensitive
  context until the runtime's tool blocking and context isolation are verified.
- Tests exercise persisted handoff state, owner gating, prompt and tool hooks,
  and patch anchor/syntax checks against the pinned plugin. No live WhatsApp
  test has been performed. Verify handset observation, owner-tool visibility,
  a real auto-reply, no reply to an unknown sender, and expiry/revocation
  before enabling on the primary number.
- No per-message approval, proactive reply to a previous inbound message,
  or automatic detection of task completion.
