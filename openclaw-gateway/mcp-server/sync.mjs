const DEFAULT_REPOSITORY = "nimanizky/chief-of-staff";
const DEFAULT_WORKFLOW = "openclaw-obsidian-manual-sync.yml";
const DEFAULT_REF = "main";

export function createSyncAdapter({
  token = process.env.MCP_SYNC_GITHUB_TOKEN,
  repository = process.env.MCP_SYNC_GITHUB_REPOSITORY || DEFAULT_REPOSITORY,
  workflow = process.env.MCP_SYNC_GITHUB_WORKFLOW || DEFAULT_WORKFLOW,
  ref = process.env.MCP_SYNC_GITHUB_REF || DEFAULT_REF,
  fetchImpl = fetch
} = {}) {
  return {
    async triggerSync() {
      if (typeof token !== "string" || !token.trim()) {
        throw new Error("MCP_SYNC_GITHUB_TOKEN is not configured. Add a fine-grained GitHub token with Actions: write permission for the chief-of-staff repository.");
      }
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
        throw new Error("MCP_SYNC_GITHUB_REPOSITORY must use owner/repository format.");
      }
      if (!/^[A-Za-z0-9_.-]+$/.test(workflow)) {
        throw new Error("MCP_SYNC_GITHUB_WORKFLOW must be a workflow filename or ID.");
      }
      if (!/^[A-Za-z0-9_.\/-]+$/.test(ref) || ref.startsWith("/") || ref.includes("..")) {
        throw new Error("MCP_SYNC_GITHUB_REF must be a safe Git ref.");
      }

      const endpoint = `https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ ref, inputs: { confirm_sync: true } })
      });

      if (response.status !== 204) {
        const detail = await response.text().catch(() => "");
        throw new Error(`GitHub Actions refused the sync dispatch (HTTP ${response.status})${detail ? `: ${detail.slice(0, 500)}` : ""}.`);
      }

      return {
        status: "queued",
        trigger: "github_actions",
        repository,
        workflow,
        ref,
        message: "The OpenClaw-to-Obsidian sync workflow was dispatched. Check the repository Actions tab for the final result."
      };
    }
  };
}
