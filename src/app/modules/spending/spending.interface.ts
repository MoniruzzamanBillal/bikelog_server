export type TSpendingCategoryBreakdown = {
  category: string;
  total: number;
};

export type TSpendingSummary = {
  period: "month" | "year" | "lifetime";
  targetMonth?: string;
  targetYear?: string;
  totalSpending: number;
  categoryBreakdown: TSpendingCategoryBreakdown[];
};

// ! Spec 54 §F/H11: `"oil"` added for the engine oil log module. Both clients declare
// ! their own copy of this union and never switch on it, so a value they do not know
// ! about is harmless at runtime — but fix the web copy in its spec 33 and log the
// ! app's as a Known Gap rather than leaving two more stale types behind.
export type TSpendingRecordSource =
  | "fuel"
  | "maintenance"
  | "accessory"
  | "oil";

export type TSpendingRecord = {
  date: Date;
  category: string;
  description: string;
  amount: number;
  vendor: string | null;
  remarks: string | null;
  source: TSpendingRecordSource;
};

export type TSpendingDetails = {
  period: "month" | "year" | "lifetime";
  targetMonth?: string;
  targetYear?: string;
  totalSpending: number;
  categoryBreakdown: TSpendingCategoryBreakdown[];
  records: TSpendingRecord[];
};

// ! Spec 60: the monthly drill-down. One category per bucket, its line-item records
// ! nested inside it, so the app's Month tab can render each category as an accordion
// ! without re-grouping a flat records[] client-side. Month-only by design — the Year,
// ! Lifetime and Trend tabs keep consuming the plain summary endpoint.
export type TSpendingCategoryGroup = {
  category: string;
  total: number;
  records: TSpendingRecord[];
};

export type TMonthlyCategoryBreakdown = {
  period: "month";
  targetMonth: string;
  totalSpending: number;
  categories: TSpendingCategoryGroup[];
};
