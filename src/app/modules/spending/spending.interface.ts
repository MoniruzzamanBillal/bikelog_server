export type TSpendingCategoryBreakdown = {
  category: string;
  total: number;
};

export type TSpendingSummary = {
  period: "month" | "year";
  totalSpending: number;
  categoryBreakdown: TSpendingCategoryBreakdown[];
};
