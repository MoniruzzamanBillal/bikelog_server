export type TEngineOilType = {
  name: string;
  suggestedIntervalKm: number;
  // ! `ownerId` is deliberately NOT here — it comes from the verified JWT in the
  // ! controller, never from the request body (spec 46 §"Explicitly NOT changing").
};
