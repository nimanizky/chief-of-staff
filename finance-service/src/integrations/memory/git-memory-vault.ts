import { relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env } from "../../config/env.js";

const execFileAsync = promisify(execFile);

export type MemoryVaultGitResult =
  | {
      status: "skipped";
      reason: "disabled" | "missing_vault_path" | "outside_vault" | "no_changes";
    }
  | {
      status: "committed";
      pushed: boolean;
    };

export async function commitMemoryVaultFile(filePath: string, message: string): Promise<MemoryVaultGitResult> {
  if (!env.OPENCLAW_MEMORY_GIT_AUTO_COMMIT) {
    return { status: "skipped", reason: "disabled" };
  }

  if (!env.OPENCLAW_MEMORY_VAULT_PATH) {
    return { status: "skipped", reason: "missing_vault_path" };
  }

  const vaultPath = resolve(env.OPENCLAW_MEMORY_VAULT_PATH);
  const absoluteFilePath = resolve(filePath);
  const relativeFilePath = relative(vaultPath, absoluteFilePath);

  if (relativeFilePath.startsWith("..") || relativeFilePath === "" || relativeFilePath.includes(":")) {
    return { status: "skipped", reason: "outside_vault" };
  }

  await git(vaultPath, ["add", "--", relativeFilePath]);

  const hasChanges = await hasStagedChanges(vaultPath, relativeFilePath);
  if (!hasChanges) {
    return { status: "skipped", reason: "no_changes" };
  }

  await git(vaultPath, ["commit", "-m", message, "--", relativeFilePath]);

  if (env.OPENCLAW_MEMORY_GIT_AUTO_PUSH) {
    await git(vaultPath, ["push"]);
  }

  return {
    status: "committed",
    pushed: env.OPENCLAW_MEMORY_GIT_AUTO_PUSH
  };
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function hasStagedChanges(cwd: string, relativeFilePath: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["diff", "--cached", "--quiet", "--", relativeFilePath], { cwd });
    return false;
  } catch (error) {
    const exitCode = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (exitCode === 1) return true;
    throw error;
  }
}
