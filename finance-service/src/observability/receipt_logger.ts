type ReceiptOutcome = "appended" | "duplicate" | "error";

type ReceiptLogEntry = {
  receipt_id: string;
  outcome: ReceiptOutcome;
  merchant_name?: string;
  receipt_date?: string;
  classification?: string;
  confidence?: number;
  needs_review?: boolean;
  reason?: string;
  status?: number;
  metadata?: Record<string, unknown>;
};

export function logReceiptOutcome(entry: ReceiptLogEntry): void {
  const safeEntry = {
    ts: new Date().toISOString(),
    ...entry
  };
  console.info(`[receipt] ${JSON.stringify(safeEntry)}`);
}
