import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const stateDir = process.env.OPENCLAW_STATE_DIR || "/home/node/.openclaw";
const templatePath = process.env.OPENCLAW_CONFIG_TEMPLATE || "/app/openclaw.example.json";
const configPath = join(stateDir, "openclaw.json");
await mkdir(stateDir, { recursive: true });

try {
  await readFile(configPath, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const config = JSON.parse(await readFile(templatePath, "utf8"));
  if (process.env.MCP_SERVER_URL) {
    if (!process.env.MCP_SERVER_TOKEN) throw new Error("MCP_SERVER_TOKEN is required when MCP_SERVER_URL is set");
    config.mcp = { servers: { external: {
      url: "${MCP_SERVER_URL}",
      transport: "streamable-http",
      headers: { Authorization: "Bearer ${MCP_SERVER_TOKEN}" }
    } } };
  }
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log("Created initial OpenClaw config; configure channels and a model before use.");
}
