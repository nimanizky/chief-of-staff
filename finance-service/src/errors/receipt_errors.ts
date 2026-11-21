export type ReceiptErrorCode =
  | "MODEL_TEMPORARY"
  | "MODEL_PERMANENT"
  | "SHEETS_READ"
  | "SHEETS_WRITE"
  | "MEDIA_FETCH"
  | "UNSUPPORTED_MEDIA"
  | "PDF_DISABLED"
  | "PDF_CONVERSION";

type ReceiptErrorOptions = {
  cause?: unknown;
  status?: number;
  metadata?: Record<string, unknown>;
};

export class ReceiptError extends Error {
  readonly code: ReceiptErrorCode;
  readonly status?: number;
  readonly metadata: Record<string, unknown>;

  constructor(code: ReceiptErrorCode, message: string, options: ReceiptErrorOptions = {}) {
    super(message);
    this.name = "ReceiptError";
    this.code = code;
    this.status = options.status;
    this.metadata = options.metadata ?? {};
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function getErrorStatus(error: unknown): number | undefined {
  const status = Number(
    (error as { status?: number; response?: { status?: number } })?.status ??
      (error as { response?: { status?: number } })?.response?.status
  );
  return Number.isFinite(status) ? status : undefined;
}
