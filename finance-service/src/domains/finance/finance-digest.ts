export type WeeklySpendRow = {
  weekStart: string;
  weekEnd: string;
  paymentMethod: string;
  amountSpent: number;
};

export type PaymentCalendarRow = {
  dueDate: string;
  paymentMethod: string;
  amountDue: number;
};

export type ReceiptQualityRow = {
  receiptDate: string;
  paymentMethod: string;
  needsReview: boolean;
};

export type FinanceSourceResult<T> = {
  rows: T[];
  warnings: string[];
};

export type FinanceDigestRepository = {
  readWeeklySpend(): Promise<FinanceSourceResult<WeeklySpendRow>>;
  readPaymentCalendar(): Promise<FinanceSourceResult<PaymentCalendarRow>>;
  readReceiptQuality(): Promise<FinanceSourceResult<ReceiptQualityRow>>;
};

export type FinanceDigest = {
  generatedAt: string;
  localDate: string;
  weeklySpend: Array<{
    paymentMethod: string;
    amountSpent: number;
  }>;
  totalToReserve: number;
  upcomingPayments: PaymentCalendarRow[];
  warnings: string[];
  partial: boolean;
  unavailable: boolean;
};

export type FinanceDigestOptions = {
  now?: Date;
  timezone: string;
  lookaheadDays: number;
};
