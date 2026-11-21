# WhatsApp conversation policy: implementation design

Status: design only. This document does not enable the feature or change the
running gateway. Do not claim an approval guarantee until all paths are tested.

## Goal

An authenticated owner can initiate a WhatsApp conversation in either mode:

- `automatic`: the agent may reply within the task's authorized scope.
- `approval`: inbound messages become pending owner decisions; no reply is sent
  to the external recipient without explicit approval of that exact message.

Unknown senders are ignored, without pairing messages. Phone numbers and message
content belong in private persistent state, never in source code or test fixtures.
WhatsApp groups retain independent policy.

## Trust boundary

This is not achieved by a system prompt or by setting `dmPolicy` alone. The
owner identity must be authenticated by the gateway, not inferred from text in
a message. Restaurant messages and attachments are untrusted. No payment,
sharing secrets, irreversible action, or change to task scope is authorized by
the automatic mode itself.

An integration must gate all applicable inbound, agent reply, outbound message,
scheduled and tool paths; it must fail closed on missing or invalid state. Verify
the installed OpenClaw version's hook coverage and ordering before selecting an
integration. Native allowlist and prior pairing records can both affect inbound
access and must be audited, not assumed empty.

## Proposed lifecycle

1. Owner authorizes recipient, mode, task scope and expiry; registration and
   outbound delivery are coordinated so failures never silently grant access.
2. Persist conversation and delivery state durably with restricted permissions;
   use stable recipient identifiers and isolate accounts. Avoid phone numbers in
   logs, screenshots, GitHub variables, and repository files.
3. For `approval`, store incoming events idempotently, notify only the verified
   owner, and require an approval bound to a pending message and exact outgoing
   text. Replays, changed content, stale approvals and concurrent attempts fail
   closed. Give the owner a way to edit, reject, revoke and close a conversation.
4. For `automatic`, enforce task limits and escalation for sensitive actions;
   messages from the recipient cannot expand permissions.
5. Persist state across restarts, support encrypted off-host backups and test
   recovery, missed messages and duplicate delivery. Avoid claiming exactly-once
   message delivery unless the transport actually provides it.

## Verification required before rollout

- Unknown recipient gets no bot response or pairing request.
- Approved recipient can reply; automatic mode respects authorization limits.
- Approval mode never sends to recipient before the real owner's approval,
  including tool, scheduled, retry, restart and race-condition paths.
- A different sender, forged approval, modified draft and replay cannot approve.
- Failure of policy state, gateway connection or notification fails closed.
- Closing/revoking survives restart; no phone numbers or secrets enter git/logs.
- WhatsApp group behavior and existing owner access remain unchanged.

## Deployment

Implementation, native-version compatibility, server migration, monitoring and
rollback are not yet complete. Do not deploy this design as if it implements
the policy. Runtime configuration and personal identifiers must not be included
in a pull request.
