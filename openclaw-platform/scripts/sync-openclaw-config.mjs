import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const sourcePath = resolve("config/openclaw.config.json");
const targetPath = resolve(".openclaw-home/.openclaw/openclaw.json");

const source = JSON.parse(await readFile(sourcePath, "utf8"));
const current = await readJsonIfExists(targetPath);

const currentToken = current?.gateway?.auth?.token;
if (currentToken) {
  source.gateway ??= {};
  source.gateway.auth ??= {};
  source.gateway.auth.token = currentToken;
}

rewriteLocalPathsForRuntime(source);

await mkdir(dirname(targetPath), { recursive: true });
await writeFile(targetPath, `${JSON.stringify(source, null, 2)}\n`, "utf8");
console.log(`Synced OpenClaw config: ${sourcePath} -> ${targetPath}`);

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function rewriteLocalPathsForRuntime(config) {
  if (process.cwd() !== "/app") return;

  // The Docker gateway runs as root, so Chromium needs --no-sandbox there.
  // Keep these Linux-specific settings out of host installations.
  config.browser = {
    ...config.browser,
    enabled: true,
    headless: true,
    noSandbox: true,
    executablePath: "/usr/bin/chromium"
  };

  const replacements = new Map([
    ["/Users/nurrizky/dev/chief-of-staff/openclaw-platform/hooks", "/app/hooks"],
    ["/Users/nurrizky/dev/chief-of-staff/openclaw-platform/plugins/task-gate", "/app/plugins/task-gate"]
  ]);

  const extraDirs = config?.hooks?.internal?.load?.extraDirs;
  if (Array.isArray(extraDirs)) {
    config.hooks.internal.load.extraDirs = extraDirs.map((entry) => replacements.get(entry) ?? entry);
  }

  const pluginPaths = config?.plugins?.load?.paths;
  if (Array.isArray(pluginPaths)) {
    config.plugins.load.paths = pluginPaths.map((entry) => replacements.get(entry) ?? entry);
  }
}
