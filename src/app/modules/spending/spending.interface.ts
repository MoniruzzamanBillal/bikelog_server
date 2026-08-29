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

export type TSpendingRecordSource = "fuel" | "maintenance" | "accessory";

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
