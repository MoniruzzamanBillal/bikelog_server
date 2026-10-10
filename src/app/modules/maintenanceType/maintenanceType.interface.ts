export type TMaintenanceType = {
  name: string;
  defaultIntervalKm?: number | null;
  defaultIntervalDays?: number | null;
  // ! Spec 46 §G: replaces the clients' `name === "Engine Oil"` gate on the engine-oil
  // ! dropdown. That exact-name match only ever worked because the global catalog happened
  // ! to be seeded with that row; with per-user catalogs and no seeding it would be dead
  // ! for every new user. Set by the owner in the catalog UI.
  requiresOilType?: boolean;
  // ! `ownerId` is deliberately NOT here. It comes from the verified JWT in the controller,
  // ! never from the request body — putting it in this type (and therefore in the Zod
  // ! schema) would reintroduce the IDOR through the front door (§"Explicitly NOT changing").
};
