/**
 * Offline test bootstrap. Some modules validate the process environment at
 * import time, so tests that pull them in need the required variables set
 * before that happens. Import this module FIRST in such a test: ES modules are
 * evaluated in import order, so these assignments run before the modules that
 * read them.
 *
 * Every value is an unroutable placeholder. Nothing here reaches Google Sheets,
 * a model provider, or the filesystem paths named below.
 */
const offlineDefaults: Record<string, string> = {
  GOOGLE_APPLICATION_CREDENTIALS: "/nonexistent/offline-test-credentials.json",
  RECEIPT_SPREADSHEET_ID: "offline-test-spreadsheet",
  RECEIPT_JOURNAL_PATH: "/nonexistent/offline-test-journal.md"
};

for (const [name, value] of Object.entries(offlineDefaults)) {
  if (!process.env[name]?.trim()) {
    process.env[name] = value;
  }
}
