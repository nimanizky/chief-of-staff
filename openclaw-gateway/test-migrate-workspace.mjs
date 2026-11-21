import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = await mkdtemp(join(tmpdir(), "openclaw-workspace-migration-"));
const stateDir = join(root, "state");
const legacyDir = join(stateDir, "workspace");
const workspaceDir = join(root, "workspace");
const configPath = join(stateDir, "openclaw.json");

try {
  await mkdir(legacyDir, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(configPath, JSON.stringify({
    agents: { defaults: { workspace: "~/.openclaw/workspace" } }
  }));
  await writeFile(join(legacyDir, "MEMORY.md"), "# Existing memory\n");
  await mkdir(join(legacyDir, "memory"), { recursive: true });
  await writeFile(join(legacyDir, "memory", "2026-11-21.md"), "Daily memory\n");
  await writeFile(join(legacyDir, ".env"), "DO_NOT_COPY=true\n");
  await writeFile(join(legacyDir, "auth.json"), "{\"token\":\"do-not-copy\"}\n");
  await writeFile(join(legacyDir, "agent.sqlite"), "not a real database");
  await mkdir(join(legacyDir, "secrets"), { recursive: true });
  await writeFile(join(legacyDir, "secrets", "api-token.txt"), "never copy this");
  await mkdir(join(legacyDir, "node_modules", "sample"), { recursive: true });
  await writeFile(join(legacyDir, "node_modules", "sample", "index.js"), "secret");
  await symlink(join(legacyDir, "MEMORY.md"), join(legacyDir, "memory-link.md"));

  const env = {
    ...process.env,
    OPENCLAW_LEGACY_STATE_DIR: stateDir,
    OPENCLAW_WORKSPACE_DIR: workspaceDir,
    OPENCLAW_ALLOW_EMPTY_LEGACY_WORKSPACE: "false"
  };
  const run = () => spawnSync(process.execPath, [resolve("migrate-workspace.mjs")], {
    env,
    encoding: "utf8"
  });

  const first = run();
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.equal(await readFile(join(workspaceDir, "MEMORY.md"), "utf8"), "# Existing memory\n");
  assert.equal(await readFile(join(workspaceDir, "memory", "2026-11-21.md"), "utf8"), "Daily memory\n");
  await assert.rejects(readFile(join(workspaceDir, ".env"), "utf8"));
  await assert.rejects(readFile(join(workspaceDir, "auth.json"), "utf8"));
  await assert.rejects(readFile(join(workspaceDir, "agent.sqlite"), "utf8"));
  await assert.rejects(readFile(join(workspaceDir, "secrets", "api-token.txt"), "utf8"));
  await assert.rejects(readFile(join(workspaceDir, "node_modules", "sample", "index.js"), "utf8"));
  await assert.rejects(readFile(join(workspaceDir, "memory-link.md"), "utf8"));

  await writeFile(join(legacyDir, "MEMORY.md"), "# Changed after migration\n");
  const second = run();
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(await readFile(join(workspaceDir, "MEMORY.md"), "utf8"), "# Existing memory\n");

  const conflictRoot = await mkdtemp(join(tmpdir(), "openclaw-workspace-conflict-"));
  try {
    const conflictState = join(conflictRoot, "state");
    const conflictLegacy = join(conflictState, "workspace");
    const conflictWorkspace = join(conflictRoot, "workspace");
    await mkdir(conflictLegacy, { recursive: true });
    await mkdir(conflictWorkspace, { recursive: true });
    await writeFile(join(conflictLegacy, "MEMORY.md"), "legacy");
    await writeFile(join(conflictState, "openclaw.json"), "{}");
    await writeFile(join(conflictWorkspace, "MEMORY.md"), "pre-existing target");
    const conflict = spawnSync(process.execPath, [resolve("migrate-workspace.mjs")], {
      env: {
        ...process.env,
        OPENCLAW_LEGACY_STATE_DIR: conflictState,
        OPENCLAW_WORKSPACE_DIR: conflictWorkspace,
        OPENCLAW_ALLOW_EMPTY_LEGACY_WORKSPACE: "false"
      },
      encoding: "utf8"
    });
    assert.notEqual(conflict.status, 0);
    assert.equal(await readFile(join(conflictWorkspace, "MEMORY.md"), "utf8"), "pre-existing target");
    assert.equal(await readFile(join(conflictLegacy, "MEMORY.md"), "utf8"), "legacy");
  } finally {
    await rm(conflictRoot, { recursive: true, force: true });
  }

  console.log("Workspace migration tests passed.");
} finally {
  await rm(root, { recursive: true, force: true });
}
