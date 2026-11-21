import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

const stateDir = resolve(process.env.OPENCLAW_LEGACY_STATE_DIR || "/legacy-state");
const workspaceDir = resolve(process.env.OPENCLAW_WORKSPACE_DIR || "/workspace");
const markerPath = join(stateDir, ".workspace-migration-v1.json");
const sentinelPath = join(workspaceDir, ".openclaw-workspace-volume.json");
const legacyWorkspaceDir = join(stateDir, "workspace");
const allowEmpty = process.env.OPENCLAW_ALLOW_EMPTY_LEGACY_WORKSPACE === "true";
let skippedCount = 0;

const existingMarker = await readJsonIfExists(markerPath);
if (existingMarker) {
  const sentinel = await readJsonIfExists(sentinelPath);
  if (!sentinel || sentinel.volumeId !== existingMarker.volumeId) {
    throw new Error(
      "Workspace volume marker is missing or mismatched. Refusing to start with an empty/replaced workspace volume."
    );
  }
  console.log(
    `Workspace migration already completed: ${existingMarker.fileCount} files, volumeId=${existingMarker.volumeId}`
  );
  process.exit(0);
}

await assertDefaultWorkspaceConfig(join(stateDir, "openclaw.json"));
await mkdir(workspaceDir, { recursive: true });

const sourceStat = await lstatOrNull(legacyWorkspaceDir);
if (!sourceStat || !sourceStat.isDirectory()) {
  if (!allowEmpty) {
    throw new Error(
      `Legacy workspace not found at ${legacyWorkspaceDir}. Set OPENCLAW_ALLOW_EMPTY_LEGACY_WORKSPACE=true only for a genuinely new installation; existing state was not modified.`
    );
  }
  await completeMigration({
    fileCount: 0,
    copiedCount: 0,
    skippedCount: 0,
    manifestHash: createHash("sha256").update("").digest("hex"),
    status: "empty-new-install"
  });
  console.log("No legacy workspace found; initialized an empty persistent workspace.");
  process.exit(0);
}

const sourceFiles = await collectFiles(legacyWorkspaceDir, { includeExcluded: false });
const targetFiles = await collectFiles(workspaceDir, { includeExcluded: true });

for (const [path, targetHash] of targetFiles) {
  const sourceHash = sourceFiles.get(path);
  if (!sourceHash || sourceHash !== targetHash) {
    throw new Error(
      `Workspace target already contains an unexpected or different file: ${path}. Nothing was overwritten; inspect both locations before retrying.`
    );
  }
}

let copiedCount = 0;

for (const [path, sourceHash] of sourceFiles) {
  const sourcePath = join(legacyWorkspaceDir, path);
  const targetPath = join(workspaceDir, path);
  const targetStat = await lstatOrNull(targetPath);

  if (targetStat) {
    if (!targetStat.isFile()) {
      throw new Error(`Workspace target path is not a regular file: ${path}`);
    }
    const targetHash = await hashFile(targetPath);
    if (targetHash !== sourceHash) {
      throw new Error(`Workspace target checksum mismatch: ${path}`);
    }
    continue;
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
  const copiedHash = await hashFile(targetPath);
  if (copiedHash !== sourceHash) {
    throw new Error(`Checksum verification failed after copying ${path}`);
  }
  copiedCount += 1;
}

const verifiedFiles = await collectFiles(workspaceDir, { includeExcluded: false });
for (const [path, sourceHash] of sourceFiles) {
  if (verifiedFiles.get(path) !== sourceHash) {
    throw new Error(`Post-migration verification failed for ${path}`);
  }
}
for (const path of verifiedFiles.keys()) {
  if (!sourceFiles.has(path)) {
    throw new Error(`Unexpected file appeared in workspace during migration: ${path}`);
  }
}

const manifest = [...sourceFiles.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, hash]) => `${path}\0${hash}\n`)
  .join("");
await completeMigration({
  fileCount: sourceFiles.size,
  copiedCount,
  skippedCount,
  manifestHash: createHash("sha256").update(manifest).digest("hex"),
  status: "copied"
});

console.log(
  `Workspace migration verified: ${sourceFiles.size} files, ${copiedCount} copied, ${skippedCount} skipped. Legacy source retained at ${legacyWorkspaceDir}.`
);

async function assertDefaultWorkspaceConfig(configPath) {
  const config = await readJsonIfExists(configPath);
  const allowed = new Set([
    "/workspace",
    "~/.openclaw/workspace",
    "/home/node/.openclaw/workspace"
  ]);
  const defaultsWorkspace = config?.agents?.defaults?.workspace;
  const mainWorkspace = Array.isArray(config?.agents?.list)
    ? config.agents.list.find((agent) => agent?.id === "main")?.workspace
    : undefined;

  for (const [label, value] of [
    ["agents.defaults.workspace", defaultsWorkspace],
    ["agents.list[main].workspace", mainWorkspace]
  ]) {
    if (value && !allowed.has(value)) {
      throw new Error(
        `Custom ${label}="${value}" detected. Refusing automatic migration; review this workspace path first.`
      );
    }
  }
}

async function collectFiles(root, { includeExcluded }) {
  const result = new Map();

  async function visit(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const rel = prefix ? join(prefix, entry.name) : entry.name;
      if (rel === "lost+found" || rel.startsWith(`lost+found${sep}`)) continue;
      if (rel === ".openclaw-workspace-volume.json") continue;
      if (!includeExcluded && isExcluded(rel)) {
        skippedCount += 1;
        continue;
      }

      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        if (includeExcluded) {
          throw new Error(`Symbolic links are not allowed in the new workspace volume: ${rel}`);
        }
        skippedCount += 1;
        continue;
      }
      if (entry.isDirectory()) {
        await visit(absolute, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      result.set(rel, await hashFile(absolute));
    }
  }

  await visit(root);
  return result;
}

function isExcluded(path) {
  const parts = path.split(sep);
  const name = parts.at(-1).toLowerCase();
  if (parts.some((part) => [".git", ".openclaw", "node_modules", ".cache"].includes(part))) return true;
  if (name === ".env" || name.startsWith(".env.")) return true;
  if (["auth.json", "credentials.json", "id_rsa", "id_ed25519"].includes(name)) return true;
  return /\.(sqlite3?|db|pem|key|p12|pfx)$/i.test(name);
}

async function hashFile(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

async function lstatOrNull(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function completeMigration({ fileCount, copiedCount, skippedCount, manifestHash, status }) {
  const existingSentinel = await readJsonIfExists(sentinelPath);
  const volumeId = existingSentinel?.volumeId || randomUUID();
  await writeJsonAtomic(sentinelPath, {
    version: 1,
    volumeId,
    createdAt: existingSentinel?.createdAt || new Date().toISOString()
  });
  await writeJsonAtomic(markerPath, {
    version: 1,
    volumeId,
    status,
    sourcePath: legacyWorkspaceDir,
    targetPath: workspaceDir,
    fileCount,
    copiedCount,
    skippedCount,
    manifestHash,
    completedAt: new Date().toISOString()
  });
}

async function writeJsonAtomic(path, value) {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, path);
}
