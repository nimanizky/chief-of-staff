import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const gatewayScript = resolve(packageRoot, "scripts/openclaw-local.sh");
const financeServerScript = resolve(packageRoot, "dist/scripts/finance_api_server.js");

type ManagedChild = { process: ChildProcess; closed: boolean; name: string };
const children: ManagedChild[] = [];
let shuttingDown = false;
let shutdownCode = 0;
let forceKillTimer: NodeJS.Timeout | undefined;

const financeApiEnabled = ["1", "true", "yes", "on"].includes(
  process.env.FINANCE_API_ENABLED?.trim().toLowerCase() ?? ""
);
if (financeApiEnabled && (process.env.FINANCE_API_TOKEN?.trim().length ?? 0) < 32) {
  throw new Error("FINANCE_API_TOKEN is required when FINANCE_API_ENABLED=true.");
}

if (financeApiEnabled) {
  startChild(process.execPath, [financeServerScript], "finance-api");
}
startChild(gatewayScript, ["gateway"], "openclaw-gateway");

process.once("SIGINT", () => stopChildren(0, "SIGINT"));
process.once("SIGTERM", () => stopChildren(0, "SIGTERM"));

function startChild(command: string, args: string[], name: string): void {
  const child = spawn(command, args, {
    cwd: packageRoot,
    env: process.env,
    stdio: "inherit"
  });
  const managedChild: ManagedChild = { process: child, closed: false, name };
  children.push(managedChild);

  child.once("error", (error) => {
    console.error(`[gateway-supervisor] ${name} failed to start:`, error.message);
    stopChildren(1, `${name} start failure`);
  });
  child.once("close", (code, signal) => {
    managedChild.closed = true;
    if (!shuttingDown) {
      const reason = code === null ? `${name} stopped by ${signal ?? "unknown signal"}` : `${name} exited with code ${code}`;
      stopChildren(code ?? 1, reason);
    }
    finishIfChildrenStopped();
  });
}

function stopChildren(code: number, reason: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  shutdownCode = code;
  console.log(`[gateway-supervisor] stopping child processes after ${reason}`);

  for (const child of children) {
    if (!child.closed && child.process.pid !== undefined) child.process.kill("SIGTERM");
  }

  forceKillTimer = setTimeout(() => {
    for (const child of children) {
      if (!child.closed && child.process.pid !== undefined) child.process.kill("SIGKILL");
    }
  }, 10_000);
  forceKillTimer.unref();
  finishIfChildrenStopped();
}

function finishIfChildrenStopped(): void {
  if (!shuttingDown || children.some((child) => !child.closed)) return;
  if (forceKillTimer) clearTimeout(forceKillTimer);
  process.exitCode = shutdownCode;
}
