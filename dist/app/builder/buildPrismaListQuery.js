"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPrismaListQuery = void 0;
const buildPrismaListQuery = ({ baseWhere, query, defaultSort, }) => {
    const excluded = ["searchTerm", "sort", "limit", "page", "fields"];
    const extraFilters = Object.fromEntries(Object.entries(query).filter(([key]) => !excluded.includes(key)));
    const sortStr = query.sort || defaultSort;
    const orderBy = sortStr.split(",").map((field) => field.startsWith("-")
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
