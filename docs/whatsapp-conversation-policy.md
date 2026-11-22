# WhatsApp conversation handoff

Experimental and off by default. Validate on a dedicated test account first.

An owner can also ask OpenClaw to initiate a new conversation and continue it.
The `whatsapp_handoff` tool's `initiate` action sends the first text using the
active WhatsApp connection, then records a one-hour handoff for that recipient.
The owner must provide the recipient, initial message and task goal. No shell
command or separate registration is needed for the conversation.

This only applies when the agent actually chooses `whatsapp_handoff` with
`initiate`: the generic message tool does not automatically grant access.
Handoff state is written after the send succeeds, so an exceptionally fast
reply can arrive before admission is enabled. If state persistence fails after
delivery, verify the conversation before retrying to avoid duplicate messages.

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
  owner-initiated first message, a real auto-reply, no reply to an unknown sender, and expiry/revocation
  before enabling on the primary number.
- No per-message approval, proactive reply to a previous inbound message,
  or automatic detection of task completion.
