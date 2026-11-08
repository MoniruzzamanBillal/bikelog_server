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
  // ! Spec 61: litres for a fuel record, null for every other source. Additive — the
  // ! Month-tab drill-down (spec 60) and the PDF export ignore it; only the Year/Lifetime
  // ! period breakdown reads it, to show per-bucket litres on the Fuel category.
  liters: number | null;
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

// ! Spec 61: the Year / Lifetime drill-down. Same accordion idea as spec 60's month
// ! breakdown, but a category expands to TIME BUCKETS instead of individual records —
// ! per-month for a year, per-year for lifetime. Each bucket carries its total and (fuel
// ! only) its litres. `liters`/`totalLiters` are null for a non-fuel category.
export type TSpendingPeriodBucket = {
  key: string; // "2026-01" for a month bucket, "2026" for a year bucket
  label: string; // "Jan" / "2026" — pre-formatted server-side so the client renders raw
  total: number;
  liters: number | null;
};

export type TSpendingPeriodGroup = {
  category: string;
  total: number;
  totalLiters: number | null;
  buckets: TSpendingPeriodBucket[];
};

export type TPeriodCategoryBreakdown = {
  period: "year" | "lifetime";
  targetYear?: string;
  totalSpending: number;
  categories: TSpendingPeriodGroup[];
};
