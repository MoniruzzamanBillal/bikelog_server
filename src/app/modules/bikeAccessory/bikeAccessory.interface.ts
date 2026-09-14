import { TAccessoryStatus, TAccessoryUrgency } from "./bikeAccessory.constant";

export type TBikeAccessory = {
  name: string;
  urgency: TAccessoryUrgency;
  status?: TAccessoryStatus;
  price?: number;
};
