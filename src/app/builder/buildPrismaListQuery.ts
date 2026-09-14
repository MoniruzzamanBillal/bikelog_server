// Prisma-flavored replacement for Queryuilder.ts's chainable Mongoose-query API, which has
// no equivalent once a module moves to Prisma's one-shot findMany({ where, orderBy, skip, take }).
// Not a full generic class — just enough to replicate today's exact query-param contract
// (sort, limit, page, arbitrary equality filters) so list-endpoint behavior doesn't change
// for callers migrating off Queryuilder (fuelLog first; maintenanceLog/bikeIssue/bikeDocument/
// errorLog follow in later phases and reuse this same helper).
//
// Two deliberate simplifications vs. the old Queryuilder, both confirmed unused by any caller
// at the time of writing: `.search()` (no route/validation wires a `searchTerm` query param to
// any of these list endpoints) and `.field()`'s Mongoose `-__v` default (Prisma models have no
// `__v` at all, so `fields` is dropped rather than kept as a silent no-op).
type ListQueryOptions = {
  baseWhere: Record<string, unknown>;
  query: Record<string, unknown>;
  defaultSort: string;
};

export const buildPrismaListQuery = ({
  baseWhere,
  query,
  defaultSort,
}: ListQueryOptions) => {
  const excluded = ["searchTerm", "sort", "limit", "page", "fields"];
  const extraFilters = Object.fromEntries(
    Object.entries(query).filter(([key]) => !excluded.includes(key)),
  );

  const sortStr = (query.sort as string) || defaultSort;
  const orderBy = sortStr.split(",").map((field) =>
    field.startsWith("-")
      ? { [field.slice(1)]: "desc" as const }
      : { [field]: "asc" as const },
  );

  const limit = Number(query.limit) || 10;
  const page = Number(query.page) || 1;

  return {
    where: { ...baseWhere, ...extraFilters },
    orderBy,
    skip: (page - 1) * limit,
    take: limit,
  };
};
