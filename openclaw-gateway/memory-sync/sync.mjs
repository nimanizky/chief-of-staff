import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const SAFE_GITIGNORE_RULES = [
  ".openclaw-workspace-volume.json",
  ".env",
  ".env.*",
  "node_modules/",
  "*.sqlite",
  "*.sqlite3",
  "*.db",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "auth.json",
  "credentials.json",
  "id_rsa",
  "id_ed25519"
];

export function isIgnoredPath(path) {
  const normalized = path.split(sep).join("/");
  const parts = normalized.split("/");
  const name = parts.at(-1).toLowerCase();
  if (parts.some((part) => [".git", ".openclaw", "node_modules", ".cache"].includes(part))) return true;
  if (name === ".openclaw-workspace-volume.json") return true;
  if (name === ".env" || name.startsWith(".env.")) return true;
  if (["auth.json", "credentials.json", "id_rsa", "id_ed25519"].includes(name)) return true;
  return /\.(sqlite3?|db|pem|key|p12|pfx)$/i.test(name);
}

export async function mergeLegacyWorkspace(workspaceDir, cloneDir, timestamp = new Date().toISOString().replace(/[:.]/g, "-")) {
  const localFiles = await listFiles(workspaceDir);
  let imported = 0;
  let identical = 0;
  let conflicts = 0;

  for (const path of localFiles) {
    const localPath = join(workspaceDir, path);
    const remotePath = join(cloneDir, path);
    const remoteStat = await lstatOrNull(remotePath);

    if (!remoteStat) {
      try {
        await mkdir(dirname(remotePath), { recursive: true });
        await copyFile(localPath, remotePath);
        imported += 1;
      } catch (error) {
        if (error.code !== "ENOTDIR" && error.code !== "EEXIST") throw error;
        await copyLegacyConflict(cloneDir, localPath, path, timestamp);
        conflicts += 1;
      }
      continue;
    }

    if (remoteStat.isFile()) {
      if ((await hashFile(localPath)) === (await hashFile(remotePath))) {
        identical += 1;
        continue;
      }

      // Preserve the vault version separately; keep the legacy OpenClaw file
      // at its original path so old memory remains the active context.
      const remoteConflictPath = join(
        cloneDir,
        "memory",
        "migration-conflicts",
        "remote-vault",
        timestamp,
        path
      );
      await mkdir(dirname(remoteConflictPath), { recursive: true });
      await copyFile(remotePath, remoteConflictPath);
      await copyFile(localPath, remotePath);
      conflicts += 1;
      continue;
    }

    // A remote directory occupies the same path as a legacy file. Keep the
    // legacy file under a conflict folder rather than replacing the directory.
    await copyLegacyConflict(cloneDir, localPath, path, timestamp);
    conflicts += 1;
  }

  return { imported, identical, conflicts, scanned: localFiles.length };
}

async function copyLegacyConflict(cloneDir, localPath, path, timestamp) {
  const conflictPath = join(
    cloneDir,
    "memory",
    "migration-conflicts",
    "legacy-workspace",
    timestamp,
    path
  );
  await mkdir(dirname(conflictPath), { recursive: true });
  await copyFile(localPath, conflictPath);
}

export async function ensureSafeGitignore(workspaceDir) {
  const gitignorePath = join(workspaceDir, ".gitignore");
  let existing = "";
  try {
    existing = await readFile(gitignorePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const lines = new Set(existing.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const missing = SAFE_GITIGNORE_RULES.filter((rule) => !lines.has(rule));
  if (missing.length > 0) {
    const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    await writeFile(gitignorePath, `${existing}${separator}${missing.join("\n")}\n`, { mode: 0o644 });
  }
}

export async function syncOnce(options = {}) {
  const workspaceDir = resolve(options.workspaceDir || process.env.MEMORY_SYNC_WORKSPACE_DIR || "/workspace");
  const remoteUrl = options.remoteUrl || process.env.MEMORY_SYNC_REMOTE || "git@github.com:nimanizky/openclaw-obsidian-vault.git";
  const branch = options.branch || process.env.MEMORY_SYNC_BRANCH || "main";
  const keyFile = options.keyFile || process.env.MEMORY_SYNC_SSH_KEY_FILE || "/run/secrets/obsidian-vault-deploy-key";
  const authorName = options.authorName || process.env.MEMORY_SYNC_AUTHOR_NAME || "OpenClaw Memory Sync";
  const authorEmail = options.authorEmail || process.env.MEMORY_SYNC_AUTHOR_EMAIL || "openclaw-memory-sync@users.noreply.github.com";

  const ssh = await prepareGitEnvironment(remoteUrl, keyFile);
  if (!ssh) return { status: "waiting_for_key" };

  try {
    await mkdir(workspaceDir, { recursive: true });
    if (!(await isGitRepository(workspaceDir))) {
      const bootstrap = await bootstrapWorkspace({
        workspaceDir,
        remoteUrl,
        branch,
        env: ssh.env,
        authorName,
        authorEmail
      });
      return { status: "bootstrapped", ...bootstrap };
    }

    const origin = (await git(workspaceDir, ["config", "--get", "remote.origin.url"], ssh.env)).trim();
    if (origin !== remoteUrl) {
      throw new Error(`Workspace origin mismatch: expected ${remoteUrl}, found ${origin}. Refusing to push to an unexpected remote.`);
    }

    const currentBranch = (await git(workspaceDir, ["branch", "--show-current"], ssh.env)).trim();
    if (currentBranch !== branch) {
      throw new Error(`Workspace branch is "${currentBranch}", expected "${branch}". Refusing an implicit branch switch.`);
    }

    await git(workspaceDir, ["config", "user.name", authorName], ssh.env);
    await git(workspaceDir, ["config", "user.email", authorEmail], ssh.env);
    await ensureSafeGitignore(workspaceDir);
    const localCommit = await commitLocalChanges(workspaceDir, ssh.env, "memory: sync local workspace");

    await git(workspaceDir, ["fetch", "origin", branch], ssh.env);
    const localHead = (await git(workspaceDir, ["rev-parse", "HEAD"], ssh.env)).trim();
    const remoteHead = (await git(workspaceDir, ["rev-parse", `origin/${branch}`], ssh.env)).trim();

    let merged = false;
    if (localHead !== remoteHead) {
      try {
        await git(workspaceDir, ["merge", "--no-edit", `origin/${branch}`], ssh.env);
        merged = true;
      } catch (error) {
        try {
          await git(workspaceDir, ["merge", "--abort"], ssh.env);
        } catch {
          // Preserve the local commit and fetched remote ref even if abort is unnecessary.
        }
        throw new Error(
          `Git sync conflict. No force-push or reset was attempted; the local commit and origin/${branch} are preserved. Resolve the conflicting Markdown file, then run memory sync again. Details: ${error.message}`
        );
      }
    }

    await git(workspaceDir, ["push", "origin", `HEAD:${branch}`], ssh.env);
    return { status: "synced", localCommit, merged, head: localHead };
  } finally {
    await ssh.cleanup();
  }
}

async function bootstrapWorkspace({ workspaceDir, remoteUrl, branch, env, authorName, authorEmail }) {
  const tempRoot = await mkdtemp(join(tmpdir(), "openclaw-vault-bootstrap-"));
  const cloneDir = join(tempRoot, "vault");
  try {
    await git(tempRoot, ["clone", "--branch", branch, "--single-branch", remoteUrl, cloneDir], env);
    await ensureSafeGitignore(cloneDir);
    const merge = await mergeLegacyWorkspace(workspaceDir, cloneDir);
    await copyDirectoryContents(cloneDir, workspaceDir);
    await ensureSafeGitignore(workspaceDir);
    await git(workspaceDir, ["config", "user.name", authorName], env);
    await git(workspaceDir, ["config", "user.email", authorEmail], env);
    const committed = await commitLocalChanges(workspaceDir, env, "memory: import existing OpenClaw workspace");
    await git(workspaceDir, ["push", "origin", `HEAD:${branch}`], env);
    return { merge, committed };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function copyDirectoryContents(sourceDir, targetDir) {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    await cp(join(sourceDir, entry.name), join(targetDir, entry.name), {
      recursive: true,
      force: true,
      preserveTimestamps: true
    });
  }
}

async function commitLocalChanges(workspaceDir, env, message) {
  await git(workspaceDir, ["add", "-A"], env);
  const staged = (await git(workspaceDir, ["diff", "--cached", "--name-only"], env)).trim();
  if (!staged) return false;
  await git(workspaceDir, ["commit", "-m", message], env);
  return true;
}

export async function getStatus(workspaceDir = process.env.MEMORY_SYNC_WORKSPACE_DIR || "/workspace") {
  workspaceDir = resolve(workspaceDir);
  if (!(await isGitRepository(workspaceDir))) return { initialized: false, workspaceDir };

  const branch = (await git(workspaceDir, ["branch", "--show-current"])).trim();
  const remote = (await git(workspaceDir, ["config", "--get", "remote.origin.url"])).trim();
  const status = (await git(workspaceDir, ["status", "--short", "--untracked-files=all"])).trim();
  const lastCommit = (await git(workspaceDir, ["log", "-1", "--format=%h %s"])).trim();
  let aheadBehind = null;
  try {
    aheadBehind = (await git(workspaceDir, ["rev-list", "--left-right", "--count", `origin/${branch}...HEAD`])).trim();
  } catch {
    // The remote tracking ref may not exist until the first successful fetch.
  }
  return {
    initialized: true,
    workspaceDir,
    branch,
    remote,
    lastCommit,
    dirty: Boolean(status),
    status: status ? status.split("\n") : [],
    aheadBehind
  };
}

export async function restoreFile({ workspaceDir, commit, path, apply = false, syncOptions = {} }) {
  workspaceDir = resolve(workspaceDir || process.env.MEMORY_SYNC_WORKSPACE_DIR || "/workspace");
  if (!/^[0-9a-f]{7,40}$/i.test(commit || "")) {
    throw new Error("Provide a Git commit SHA (7-40 hexadecimal characters).");
  }
  const relativePath = String(path || "").replace(/\\/g, "/");
  if (
    !relativePath ||
    isAbsolute(relativePath) ||
    relativePath.split("/").some((part) => part === "..") ||
    !relativePath.toLowerCase().endsWith(".md") ||
    relativePath.startsWith(".git/") ||
    relativePath.startsWith("memory/recovery/")
  ) {
    throw new Error("Restore accepts a safe relative Markdown path only.");
  }

  const historical = await git(workspaceDir, ["show", `${commit}:${relativePath}`]);
  if (!apply) {
    return { status: "dry_run", commit, path: relativePath, bytes: Buffer.byteLength(historical) };
  }

  const targetPath = join(workspaceDir, relativePath);
  const current = await lstatOrNull(targetPath);
  let recoveryPath = null;
  if (current?.isFile()) {
    recoveryPath = join(
      workspaceDir,
      "memory",
      "recovery",
      new Date().toISOString().replace(/[:.]/g, "-"),
      relativePath
    );
    await mkdir(dirname(recoveryPath), { recursive: true });
    await copyFile(targetPath, recoveryPath);
  }
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, historical, "utf8");
  const sync = await syncOnce({ workspaceDir, ...syncOptions });
  return { status: "restored", commit, path: relativePath, recoveryPath, sync };
}

async function prepareGitEnvironment(remoteUrl, keyFile) {
  if (remoteUrl.startsWith("file://")) {
    return { env: process.env, cleanup: async () => {} };
  }
  const keyStat = await lstatOrNull(keyFile);
  if (!keyStat || !keyStat.isFile()) return null;

  const tempDir = await mkdtemp(join(tmpdir(), "openclaw-memory-ssh-"));
  const privateKeyPath = join(tempDir, "id_ed25519");
  await copyFile(keyFile, privateKeyPath);
  await chmod(privateKeyPath, 0o600);
  const knownHosts = process.env.MEMORY_SYNC_KNOWN_HOSTS_FILE || "/app/known_hosts";
  const command = [
    "ssh",
    "-i", privateKeyPath,
    "-o", "IdentitiesOnly=yes",
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${knownHosts}`
  ].join(" ");
  return {
    env: { ...process.env, GIT_SSH_COMMAND: command },
    cleanup: () => rm(tempDir, { recursive: true, force: true })
  };
}

async function isGitRepository(path) {
  try {
    await git(path, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

async function git(cwd, args, env = process.env) {
  try {
    const result = await execFile("git", args, {
      cwd,
      env,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });
    return result.stdout || "";
  } catch (error) {
    const detail = [error.stderr, error.stdout, error.message].filter(Boolean).join("\n").trim();
    throw new Error(`git ${args[0]} failed: ${detail}`);
  }
}

async function listFiles(root) {
  const files = [];
  async function visit(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relativePath = prefix ? join(prefix, entry.name) : entry.name;
      if (isIgnoredPath(relativePath)) continue;
      const absolutePath = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(absolutePath, relativePath);
      else if (entry.isFile()) files.push(relativePath);
    }
  }
  await visit(root);
  return files;
}

async function hashFile(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function lstatOrNull(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function runCli() {
  const [command = "status", ...args] = process.argv.slice(2);
  const flag = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };

  if (command === "status") {
    const status = await getStatus();
    console.log(JSON.stringify(status, null, 2));
    if (!status.initialized) process.exitCode = 1;
    return;
  }

  if (command === "sync" || command === "backup" || command === "bootstrap") {
    try {
      const result = await syncOnce();
      console.log(JSON.stringify(result, null, 2));
      if (result.status === "waiting_for_key" && command !== "bootstrap") process.exitCode = 2;
    } catch (error) {
      if (command === "bootstrap") {
        console.error(`[memory-sync-init] ${error.message}; gateway will continue with local persistent memory.`);
        return;
      }
      throw error;
    }
    return;
  }

  if (command === "restore") {
    const commit = flag("--commit");
    const path = flag("--path");
    if (!commit || !path) {
      throw new Error("Usage: restore --commit <sha> --path <relative.md> [--apply]");
    }
    const result = await restoreFile({ commit, path, apply: args.includes("--apply") });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error("Commands: status | sync | backup | bootstrap | restore --commit <sha> --path <relative.md> [--apply]");
}

async function runWorker() {
  const intervalSeconds = Number.parseInt(process.env.MEMORY_SYNC_INTERVAL_SECONDS || "60", 10);
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 10 || intervalSeconds > 3600) {
    throw new Error("MEMORY_SYNC_INTERVAL_SECONDS must be an integer between 10 and 3600.");
  }

  let waitingForKeyLogged = false;
  console.log(`[memory-sync] worker started; interval=${intervalSeconds}s`);
  while (true) {
    try {
      const result = await syncOnce();
      if (result.status === "waiting_for_key") {
        if (!waitingForKeyLogged) {
          console.log("[memory-sync] waiting for /run/secrets/obsidian-vault-deploy-key; local memory remains available.");
          waitingForKeyLogged = true;
        }
      } else {
        waitingForKeyLogged = false;
        console.log(`[memory-sync] ${result.status}: ${JSON.stringify(result)}`);
      }
    } catch (error) {
      console.error(`[memory-sync] sync failed: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  }
}

const isDirectExecution = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isDirectExecution) {
  try {
    if (process.argv.length > 2) await runCli();
    else await runWorker();
  } catch (error) {
    console.error(`[memory-sync] ${error.message}`);
    process.exitCode = 1;
  }
}
