import { spawn } from "node:child_process";

const enabled = ["1", "true", "yes", "on"].includes(process.env.MCP_SERVER_ENABLED?.trim().toLowerCase() || "");
const children = [];
let stopping = false;
let exitCode = 0;
let killTimer;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => stopChildren(0, signal));
}

startChild("/app/node_modules/.bin/openclaw", ["gateway", "run"], "openclaw-gateway");
if (enabled) {
  void startMcpAfterGatewayReady();
}

async function startMcpAfterGatewayReady() {
  try {
    await waitForGatewayReady(60_000);
    if (!stopping) startChild(process.execPath, ["/app/mcp-server/server.mjs"], "openclaw-mcp");
  } catch (error) {
    if (!stopping) {
      console.error("[supervisor] OpenClaw Gateway did not become ready:", error.message);
      stopChildren(1, "gateway readiness timeout");
    }
  }
}

async function waitForGatewayReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!stopping && Date.now() < deadline) {
    const ready = await runHealthCheck();
    if (ready) {
      console.log("[supervisor] OpenClaw Gateway is ready; starting MCP endpoint.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (!stopping) throw new Error(`Timed out after ${timeoutMs} ms.`);
}

function runHealthCheck() {
  return new Promise((resolve) => {
    const child = spawn("/app/node_modules/.bin/openclaw", ["gateway", "call", "health", "--timeout", "2000", "--json"], {
      cwd: "/app",
      env: process.env,
      stdio: "ignore"
    });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 3_000);
    timeout.unref();
    child.once("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve(code === 0);
    });
  });
}

function startChild(command, args, name) {
  const child = spawn(command, args, { cwd: "/app", env: process.env, stdio: "inherit" });
  const managed = { child, name, closed: false };
  children.push(managed);
  child.once("error", (error) => {
    console.error(`[supervisor] ${name} failed to start:`, error.message);
    stopChildren(1, `${name} start failure`);
  });
  child.once("close", (code, signal) => {
    managed.closed = true;
    if (!stopping) stopChildren(code ?? 1, `${name} exited (${code ?? signal ?? "unknown"})`);
    finishIfStopped();
  });
  return managed;
}

function stopChildren(code, reason) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  console.log(`[supervisor] stopping children after ${reason}`);
  for (const item of children) {
    if (!item.closed && item.child.pid !== undefined) item.child.kill("SIGTERM");
  }
  killTimer = setTimeout(() => {
    for (const item of children) {
      if (!item.closed && item.child.pid !== undefined) item.child.kill("SIGKILL");
    }
  }, 10_000);
  killTimer.unref();
  finishIfStopped();
}

function finishIfStopped() {
  if (!stopping || children.some((item) => !item.closed)) return;
  if (killTimer) clearTimeout(killTimer);
  process.exitCode = exitCode;
}
