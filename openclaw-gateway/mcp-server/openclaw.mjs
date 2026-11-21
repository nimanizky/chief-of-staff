import { spawn } from "node:child_process";

const GROUP_MARKER = ":whatsapp:group:";
const GROUP_JID_PATTERN = /^\d{5,}(?:-\d{5,})?@g\.us$/;

export function parseWhatsAppGroupSession(row) {
  if (!row || typeof row.key !== "string") return null;
  const markerIndex = row.key.indexOf(GROUP_MARKER);
  if (markerIndex < 0) return null;

  const agentId = row.key.slice("agent:".length, markerIndex);
  if (!agentId || !row.key.startsWith("agent:")) return null;

  const route = row.key.slice(markerIndex + GROUP_MARKER.length);
  const groupJid = route.split(":thread:whatsapp-account-")[0];
  const accountSuffix = /:thread:whatsapp-account-(.+)$/.exec(route)?.[1];
  if (!GROUP_JID_PATTERN.test(groupJid)) return null;
  if (row.channel && row.channel !== "whatsapp") return null;
  if (row.chatType && row.chatType !== "group") return null;

  return {
    group_jid: groupJid,
    session_key: row.key,
    agent_id: row.agentId || agentId,
    ...(typeof row.accountId === "string" ? { account_id: row.accountId } : accountSuffix ? { account_id: accountSuffix } : {}),
    name: firstString(row.displayName, row.label, groupJid),
    ...(typeof row.lastMessagePreview === "string" ? { last_message_preview: row.lastMessagePreview } : {}),
    ...(typeof row.lastInteractionAt === "number" ? { last_interaction_at: row.lastInteractionAt } : {}),
    ...(typeof row.updatedAt === "number" ? { updated_at: row.updatedAt } : {})
  };
}

function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0);
}

export function createOpenClawAdapter({ runCli = runOpenClawCli } = {}) {
  async function gatewayCall(method, params) {
    const response = await runCli([
      "gateway", "call", method,
      "--params", JSON.stringify(params),
      "--json"
    ]);
    if (response && typeof response === "object") {
      if (response.ok === false) throw new Error(response.error || `OpenClaw ${method} failed.`);
      if (response.payload && typeof response.payload === "object") return response.payload;
      if (response.result && typeof response.result === "object") return response.result;
    }
    return response;
  }

  async function listWhatsAppGroups() {
    const groups = [];
    const seen = new Set();
    let offset = 0;

    for (let page = 0; page < 10; page += 1) {
      const result = await gatewayCall("sessions.list", {
        source: "sidebar",
        rowMode: "sidebar",
        limit: 200,
        offset,
        sortBy: "activity",
        includeLastMessage: true,
        excludeSubagents: true,
        excludeCron: true,
        excludeSystem: true,
        excludeDock: true,
        includeGlobal: false,
        includeUnknown: false
      });
      const rows = Array.isArray(result?.sessions) ? result.sessions : [];

      for (const row of rows) {
        const group = parseWhatsAppGroupSession(row);
        if (!group || seen.has(group.session_key)) continue;
        seen.add(group.session_key);
        groups.push(group);
      }

      if (result?.hasMore !== true || rows.length === 0) break;
      const nextOffset = Number(result.nextOffset);
      offset = Number.isSafeInteger(nextOffset) && nextOffset > offset ? nextOffset : offset + rows.length;
    }

    return groups;
  }

  async function resolveGroup({ groupJid, agentId, accountId }) {
    if (typeof groupJid !== "string" || !GROUP_JID_PATTERN.test(groupJid)) {
      throw new Error("group_jid must be a WhatsApp group JID ending in @g.us.");
    }
    const matches = (await listWhatsAppGroups()).filter((group) =>
      group.group_jid === groupJid &&
      (!agentId || group.agent_id === agentId) &&
      (!accountId || group.account_id === accountId)
    );
    if (matches.length === 0) {
      throw new Error("No matching WhatsApp group session is currently visible in OpenClaw. Call whatsapp_list_groups first.");
    }
    if (matches.length > 1) {
      throw new Error("This group has multiple OpenClaw sessions. Supply agent_id and, if needed, account_id from whatsapp_list_groups.");
    }
    return matches[0];
  }

  return {
    listWhatsAppGroups,
    async readWhatsAppGroupMessages({ groupJid, agentId, accountId, limit = 50 }) {
      const group = await resolveGroup({ groupJid, agentId, accountId });
      const history = await gatewayCall("chat.history", {
        sessionKey: group.session_key,
        agentId: group.agent_id,
        limit
      });
      return {
        group_jid: group.group_jid,
        group_name: group.name,
        session_key: group.session_key,
        messages: Array.isArray(history?.messages) ? history.messages : [],
        history_source: "openclaw_session_transcript"
      };
    },
    async sendWhatsAppGroupMessage({ groupJid, agentId, accountId, message }) {
      const group = await resolveGroup({ groupJid, agentId, accountId });
      const args = ["message", "send", "--channel", "whatsapp", "--target", group.group_jid, "--message", message, "--json"];
      const selectedAccount = accountId || group.account_id;
      if (selectedAccount) args.push("--account", selectedAccount);
      const result = await runCli(args);
      return {
        sent: true,
        group_jid: group.group_jid,
        group_name: group.name,
        ...(result && typeof result === "object" ? { delivery: result } : { delivery_output: String(result ?? "") })
      };
    }
  };
}

export function runOpenClawCli(args, { bin = process.env.OPENCLAW_BIN || "/app/node_modules/.bin/openclaw", timeoutMs = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error(`OpenClaw command timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
    timeout.unref();

    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(value);
    }

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 2 * 1024 * 1024) {
        child.kill("SIGTERM");
        finish(new Error("OpenClaw command output exceeded 2 MiB."));
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 64 * 1024) stderr = stderr.slice(-64 * 1024);
    });
    child.once("error", (error) => finish(error));
    child.once("close", (code, signal) => {
      if (code !== 0) {
        finish(new Error(stderr.trim() || `OpenClaw command exited with ${code ?? signal ?? "unknown status"}.`));
        return;
      }
      const output = stdout.trim();
      if (!output) {
        finish(null, {});
        return;
      }
      try {
        finish(null, JSON.parse(output));
      } catch {
        const firstBrace = output.indexOf("{");
        const lastBrace = output.lastIndexOf("}");
        if (firstBrace >= 0 && lastBrace > firstBrace) {
          try {
            finish(null, JSON.parse(output.slice(firstBrace, lastBrace + 1)));
            return;
          } catch {
            // Preserve non-JSON CLI output for diagnostics.
          }
        }
        finish(null, { output: output.slice(0, 8_000) });
      }
    });
  });
}
