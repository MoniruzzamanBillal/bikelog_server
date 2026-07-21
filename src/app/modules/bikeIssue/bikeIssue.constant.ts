export const BikeIssueStatus = {
  open: "open",
  resolved: "resolved",
} as const;

export type TBikeIssueStatus =
  (typeof BikeIssueStatus)[keyof typeof BikeIssueStatus];
