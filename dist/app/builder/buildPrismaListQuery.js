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
    const orderBy = sortStr
        .trim()
        .split(/[\s,]+/)
        .map((field) => field.startsWith("-")
        ? { [field.slice(1)]: "desc" }
        : { [field]: "asc" });
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
