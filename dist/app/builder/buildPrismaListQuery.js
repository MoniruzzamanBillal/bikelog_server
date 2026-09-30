"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPrismaListQuery = void 0;
const buildPrismaListQuery = ({ baseWhere, query, defaultSort, }) => {
    const excluded = ["searchTerm", "sort", "limit", "page", "fields"];
    const extraFilters = Object.fromEntries(Object.entries(query).filter(([key]) => !excluded.includes(key)));
    const sortStr = query.sort || defaultSort;
    // ! split on comma OR whitespace — some callers pass a space-separated multi-field
    // ! Mongoose-style sort string (e.g. "status -dateReported") as their defaultSort, which a
    // ! comma-only split would parse as one garbage field name. Whitespace-splitting a
    // ! comma-separated string with no spaces is a no-op, so existing callers are unaffected.
    const sortFields = sortStr.trim().split(/[\s,]+/);
    const orderBy = sortFields.map((field) => field.startsWith("-")
        ? { [field.slice(1)]: "desc" }
        : { [field]: "asc" });
    // ! every list endpoint here sorts on a DATE-ONLY field (fuelLog `date`, maintenanceLog
    // ! `serviceDate`, bikeIssue `dateReported`) or a coarse enum (`status`). Clients submit those
    // ! as "yyyy-MM-dd", which z.coerce.date() stores as exactly 00:00:00.000Z — so every row
    // ! entered on the same calendar day ties, and Postgres leaves tied rows in no defined order.
    // ! Two consequences, both real bugs: a just-added log appeared at an arbitrary position among
    // ! that day's logs instead of first, and skip/take paginating over a nondeterministic order can
    // ! repeat or skip rows between pages. `createdAt` is insertion time and unique in practice, so
    // ! appending it descending makes the order total: ties fall back to newest-entered-first.
    if (!sortFields.some((field) => field.replace(/^-/, "") === "createdAt")) {
        orderBy.push({ createdAt: "desc" });
    }
    const limit = Number(query.limit) || 10;
    const page = Number(query.page) || 1;
    return {
        where: Object.assign(Object.assign({}, baseWhere), extraFilters),
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
    };
};
exports.buildPrismaListQuery = buildPrismaListQuery;
