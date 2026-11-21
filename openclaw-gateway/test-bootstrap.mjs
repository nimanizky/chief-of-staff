import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const stateDir = await mkdtemp(join(tmpdir(), "openclaw-bootstrap-test-"));
try {
  const env = {
    ...process.env,
    OPENCLAW_STATE_DIR: stateDir,
    OPENCLAW_CONFIG_TEMPLATE: resolve("openclaw.example.json"),
    MCP_SERVER_URL: "http://localhost:3100/mcp",
    MCP_SERVER_TOKEN: "offline-test-token"
  };
  const run = () => spawnSync(process.execPath, ["bootstrap.mjs"], { env, encoding: "utf8" });
  assert.equal(run().status, 0);
  const configPath = join(stateDir, "openclaw.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.mcp.servers.external.url, "${MCP_SERVER_URL}");
  assert.equal(config.mcp.servers.external.headers.Authorization, "Bearer ${MCP_SERVER_TOKEN}");
  assert.equal(JSON.stringify(config).includes("offline-test-token"), false);
  await writeFile(configPath, '{"custom":true}\n');
  assert.equal(run().status, 0);
  assert.equal(await readFile(configPath, "utf8"), '{"custom":true}\n');
  console.log("Gateway bootstrap tests passed.");
} finally {
  await rm(stateDir, { recursive: true, force: true });
}
