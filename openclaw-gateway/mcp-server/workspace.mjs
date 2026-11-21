import { constants } from "node:fs";
import { lstat, link, mkdir, open, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";

const MAX_NOTE_BYTES = 256 * 1024;
const MAX_LIST_ITEMS = 500;
const MAX_DEPTH = 8;
const BLOCKED_SEGMENTS = new Set([".git", ".openclaw", ".obsidian", "node_modules"]);

export function createWorkspaceAdapter({ root = process.env.OPENCLAW_WORKSPACE_DIR || "/workspace" } = {}) {
  const workspaceRoot = resolve(root);

  function resolveNotePath(input) {
    if (typeof input !== "string" || input.trim().length === 0 || input.length > 512) {
      throw new Error("path must be a non-empty relative Markdown path of at most 512 characters.");
    }
    if (input.includes("\\") || isAbsolute(input)) throw new Error("Absolute paths and backslashes are not allowed.");
    const segments = input.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith(".") || BLOCKED_SEGMENTS.has(segment))) {
      throw new Error("The requested path contains an invalid or protected path segment.");
    }
    if (!input.toLowerCase().endsWith(".md")) throw new Error("Only Markdown (.md) notes are supported.");
    const target = resolve(workspaceRoot, ...segments);
    const rel = relative(workspaceRoot, target);
    if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
      throw new Error("The requested path is outside the workspace.");
    }
    return { target, segments };
  }

  async function ensureSafeParent(segments, { create = false } = {}) {
    let current = workspaceRoot;
    for (const segment of segments.slice(0, -1)) {
      current = resolve(current, segment);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Symbolic links and non-directory path segments are not allowed.");
      } catch (error) {
        if (error.code !== "ENOENT" || !create) throw error;
        try {
          await mkdir(current, { mode: 0o700 });
        } catch (mkdirError) {
          if (mkdirError.code !== "EEXIST") throw mkdirError;
          const stat = await lstat(current);
          if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Symbolic links and non-directory path segments are not allowed.");
        }
      }
    }
  }

  async function listNotes({ prefix = "", limit = 100 } = {}) {
    if (typeof prefix !== "string" || prefix.length > 256) throw new Error("prefix must be a string of at most 256 characters.");
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_ITEMS) throw new Error(`limit must be between 1 and ${MAX_LIST_ITEMS}.`);
    const notes = [];

    async function walk(directory, relativeDirectory, depth) {
      if (depth > MAX_DEPTH || notes.length >= limit) return;
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (notes.length >= limit) break;
        if (entry.name.startsWith(".") || BLOCKED_SEGMENTS.has(entry.name) || entry.isSymbolicLink()) continue;
        const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
        const fullPath = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath, relativePath, depth + 1);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md") && relativePath.startsWith(prefix)) {
          const stat = await lstat(fullPath);
          notes.push({ path: relativePath, bytes: stat.size, updated_at: stat.mtimeMs });
        }
      }
    }

    await walk(workspaceRoot, "", 0);
    return { notes, count: notes.length, limit, truncated: notes.length >= limit };
  }

  async function readNote({ path }) {
    const { target, segments } = resolveNotePath(path);
    await ensureSafeParent(segments);
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error("The requested note is not a regular file.");
      if (stat.size > MAX_NOTE_BYTES) throw new Error(`The note exceeds the ${MAX_NOTE_BYTES}-byte read limit.`);
      return { path, content: await handle.readFile("utf8"), bytes: stat.size, updated_at: stat.mtimeMs };
    } finally {
      await handle.close();
    }
  }

  async function writeNote({ path, content, overwrite = false }) {
    if (typeof content !== "string") throw new Error("content must be a string.");
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_NOTE_BYTES) throw new Error(`content exceeds the ${MAX_NOTE_BYTES}-byte write limit.`);
    if (typeof overwrite !== "boolean") throw new Error("overwrite must be a boolean.");
    const { target, segments } = resolveNotePath(path);
    await ensureSafeParent(segments, { create: true });

    let existing = null;
    try {
      existing = await lstat(target);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (existing && (existing.isSymbolicLink() || !existing.isFile())) throw new Error("The destination exists but is not a regular file.");
    if (existing && !overwrite) throw new Error("The note already exists. Set overwrite=true only when replacement is intended.");

    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
      if (existing) {
        await rename(temporary, target);
      } else {
        try {
          await link(temporary, target);
        } catch (error) {
          if (error.code === "EEXIST") throw new Error("The note was created concurrently. Read it before deciding whether to overwrite.");
          throw error;
        }
        await rm(temporary, { force: true });
      }
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }

    return {
      saved: true,
      path,
      bytes,
      overwritten: Boolean(existing),
      sync: "pending_background_worker"
    };
  }

  return { listNotes, readNote, writeNote, resolveNotePath };
}
