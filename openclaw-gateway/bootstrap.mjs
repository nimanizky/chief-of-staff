import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const stateDir = process.env.OPENCLAW_STATE_DIR || "/home/node/.openclaw";
const templatePath = process.env.OPENCLAW_CONFIG_TEMPLATE || "/app/openclaw.example.json";
const configPath = join(stateDir, "openclaw.json");
const workspaceDir = process.env.OPENCLAW_WORKSPACE_DIR || "/workspace";
const legacyWorkspacePaths = new Set([
  "~/.openclaw/workspace",
  "/home/node/.openclaw/workspace"
]);

await mkdir(stateDir, { recursive: true });

let config;
let created = false;

try {
  config = JSON.parse(await readFile(configPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  config = JSON.parse(await readFile(templatePath, "utf8"));
  if (process.env.MCP_SERVER_URL) {
    if (!process.env.MCP_SERVER_TOKEN) throw new Error("MCP_SERVER_TOKEN is required when MCP_SERVER_URL is set");
    config.mcp = { servers: { external: {
      url: "${MCP_SERVER_URL}",
      transport: "streamable-http",
      headers: { Authorization: "Bearer ${MCP_SERVER_TOKEN}" }
    } } };
  }
  created = true;
}

const defaults = config.agents?.defaults ?? {};
const configuredWorkspace = defaults.workspace;
const mainAgent = Array.isArray(config.agents?.list)
  ? config.agents.list.find((agent) => agent?.id === "main")
  : undefined;
const mainAgentWorkspace = mainAgent?.workspace;

for (const [label, value] of [
  ["agents.defaults.workspace", configuredWorkspace],
  ["agents.list[main].workspace", mainAgentWorkspace]
]) {
  if (value && value !== workspaceDir && !legacyWorkspacePaths.has(value)) {
    throw new Error(
      `Refusing to replace custom ${label}="${value}". Review the workspace migration before changing it.`
    );
  }
}

const defaultsWorkspaceChanged = configuredWorkspace !== workspaceDir;
const mainWorkspaceChanged = Boolean(mainAgentWorkspace && mainAgentWorkspace !== workspaceDir);

if (defaultsWorkspaceChanged) {
  config.agents ??= {};
  config.agents.defaults ??= {};
  config.agents.defaults.workspace = workspaceDir;
}
if (mainWorkspaceChanged) {
  mainAgent.workspace = workspaceDir;
}

if (created || defaultsWorkspaceChanged || mainWorkspaceChanged) {
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, created
    ? { flag: "wx", mode: 0o600 }
    : "utf8");
  console.log(
    created
      ? "Created initial OpenClaw config with persistent workspace."
      : `Updated OpenClaw workspace to ${workspaceDir}; preserved other config.`
  );
}
