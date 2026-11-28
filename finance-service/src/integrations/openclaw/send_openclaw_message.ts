import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

export type OpenClawMessageTarget = {
  channel: "telegram" | "whatsapp";
  target: string;
  message: string;
  account?: string;
};

export async function sendOpenClawMessage(input: OpenClawMessageTarget): Promise<void> {
  const args = ["message", "send", "--channel", input.channel, "--target", input.target, "--message", input.message];
  if (input.account) {
    args.push("--account", input.account);
  }

  await run(resolveOpenClawBin(), args);
}

function resolveOpenClawBin(): string {
  const localBin = join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "openclaw.cmd" : "openclaw");
  return existsSync(localBin) ? localBin : "openclaw";
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}
