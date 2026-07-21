export const AccessoryUrgency = {
  immediate: "immediate",
  medium: "medium",
  low: "low",
} as const;

export type TAccessoryUrgency =
  (typeof AccessoryUrgency)[keyof typeof AccessoryUrgency];

export const AccessoryStatus = {
  pending: "pending",
  purchased: "purchased",
  cancelled: "cancelled",
} as const;

export type TAccessoryStatus =
  (typeof AccessoryStatus)[keyof typeof AccessoryStatus];
