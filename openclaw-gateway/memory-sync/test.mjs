import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSafeGitignore, isIgnoredPath, mergeLegacyWorkspace } from "./sync.mjs";

const root = await mkdtemp(join(tmpdir(), "openclaw-memory-sync-test-"));
const local = join(root, "legacy-workspace");
const remote = join(root, "remote-vault");

try {
  await mkdir(local, { recursive: true });
  await mkdir(remote, { recursive: true });
  await mkdir(join(remote, "memory"), { recursive: true });

  await writeFile(join(local, "MEMORY.md"), "# Legacy memory\n");
  await writeFile(join(local, "memory", "2026-11-21.md"), "Existing daily memory\n");
  await writeFile(join(local, ".env"), "TOKEN=never-sync\n");
  await writeFile(join(local, "id_ed25519"), "private key");
  await writeFile(join(remote, "MEMORY.md"), "# Vault starter memory\n");
  await writeFile(join(remote, "README.md"), "# Existing vault\n");

  const result = await mergeLegacyWorkspace(local, remote, "test-run");
  assert.equal(result.imported, 1);
  assert.equal(result.conflicts, 1);
  assert.equal(await readFile(join(remote, "MEMORY.md"), "utf8"), "# Legacy memory\n");
  assert.equal(await readFile(join(remote, "memory", "2026-11-21.md"), "utf8"), "Existing daily memory\n");
  assert.equal(await readFile(join(remote, "README.md"), "utf8"), "# Existing vault\n");
  assert.equal(
    await readFile(join(remote, "memory", "migration-conflicts", "remote-vault", "test-run", "MEMORY.md"), "utf8"),
    "# Vault starter memory\n"
  );
  assert.equal(isIgnoredPath(".env"), true);
  assert.equal(isIgnoredPath("memory/auth.json"), true);
  assert.equal(isIgnoredPath("data/finance.sqlite"), true);
  assert.equal(isIgnoredPath("memory/daily/2026-11-21.md"), false);
  await assert.rejects(readFile(join(remote, ".env"), "utf8"));
  await assert.rejects(readFile(join(remote, "id_ed25519"), "utf8"));

  await ensureSafeGitignore(remote);
  const gitignore = await readFile(join(remote, ".gitignore"), "utf8");
  assert.match(gitignore, /\.env/);
  assert.match(gitignore, /\.openclaw-workspace-volume\.json/);

  console.log("Memory sync tests passed.");
} finally {
  await rm(root, { recursive: true, force: true });
}
