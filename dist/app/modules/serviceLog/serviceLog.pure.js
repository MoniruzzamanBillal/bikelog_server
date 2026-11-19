"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.daysUntil = exports.summarizeWarranty = exports.withGeneratedIds = exports.dueState = exports.deriveStatus = exports.nextWarrantyNumber = exports.sumItemCosts = exports.round2 = exports.SERVICE_UPCOMING_DAYS = exports.DAY_MS = void 0;
const generateObjectId_1 = require("../../util/generateObjectId");
// Pure, DB-free helpers for the Service Log module — split out from serviceLog.utils (which
// imports the Prisma client) so the Vitest suite can exercise them without a Neon branch
// (spec 66's DB-free rule). serviceLog.utils re-exports everything here.
exports.DAY_MS = 1000 * 60 * 60 * 24;
// ! Same 14-day window the maintenance DATE reminders use, so a service due date and a
// ! maintenance due date surface on the banner on the same schedule. The warranty's fuller
// ! "X of 5 / void risk" picture is the /status endpoint's job, not the banner's.
exports.SERVICE_UPCOMING_DAYS = 14;
// ! item costs are JSON numbers, not Decimal columns — round here so a 300.1 + 0.2 kind of
// ! drift never reaches the spending total, which mixes this sum with Decimal-derived Numbers.
const round2 = (n) => Math.round(n * 100) / 100;
exports.round2 = round2;
// Σ of every item's cost, treating a missing/invalid cost as 0.
const sumItemCosts = (items) => {
    if (!(items === null || items === void 0 ? void 0 : items.length))
        return 0;
    const total = items.reduce((sum, item) => sum + (Number.isFinite(Number(item === null || item === void 0 ? void 0 : item.cost)) ? Number(item.cost) : 0), 0);
    return (0, exports.round2)(total);
};
exports.sumItemCosts = sumItemCosts;
// One past however many warranty services already exist for the bike. Does not clamp — a 6th
// reads as #6 (a deliberate "more than the plan's five" signal), the 1..5 bound is a
// validation concern.
const nextWarrantyNumber = (existingWarrantyCount) => existingWarrantyCount + 1;
exports.nextWarrantyNumber = nextWarrantyNumber;
// `status` is derived from whether the visit has happened (a serviceDate was recorded),
// never read from the client.
const deriveStatus = (serviceDate) => (serviceDate ? "completed" : "upcoming");
exports.deriveStatus = deriveStatus;
// A dated, still-upcoming service is overdue once its due date is in the past.
const dueState = (dueDate, now) => dueDate.getTime() < now.getTime() ? "overdue" : "upcoming";
exports.dueState = dueState;
// Give every item/recommendation a stable id (generate one for any entry sent without it),
// preserving an id the client already holds.
const withGeneratedIds = (entries) => {
    if (!entries)
        return undefined;
    return entries.map((entry) => {
        var _a;
        return (Object.assign(Object.assign({}, entry), { id: (_a = entry === null || entry === void 0 ? void 0 : entry.id) !== null && _a !== void 0 ? _a : (0, generateObjectId_1.generateObjectId)() }));
    });
};
exports.withGeneratedIds = withGeneratedIds;
// Warranty progress over all live service rows. `nextWarranty`/`nextService` are the earliest
// upcoming dated rows (warranty-only, and any-kind); void risk is any upcoming warranty
// service already past its due date.
const summarizeWarranty = (rows, now) => {
    const warrantyRows = rows.filter((r) => r.serviceKind === "warranty");
    const warrantyCompleted = warrantyRows.filter((r) => r.status === "completed").length;
    const upcomingDated = rows
        .filter((r) => r.status === "upcoming" && r.dueDate != null)
        .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    const upcomingWarranty = upcomingDated.filter((r) => r.serviceKind === "warranty");
    const summary = {
        warrantyTotal: 5,
        warrantyCompleted,
        warrantyLogged: warrantyRows.length,
        warrantyVoidRisk: upcomingWarranty.some((r) => (0, exports.dueState)(r.dueDate, now) === "overdue"),
    };
    const firstService = upcomingDated[0];
    if (firstService) {
        summary.nextService = {
            dueDate: firstService.dueDate,
            status: (0, exports.dueState)(firstService.dueDate, now),
        };
    }
    const firstWarranty = upcomingWarranty[0];
    if (firstWarranty) {
        summary.nextWarranty = {
            number: firstWarranty.warrantyNumber,
            dueDate: firstWarranty.dueDate,
            status: (0, exports.dueState)(firstWarranty.dueDate, now),
        };
    }
    return summary;
};
exports.summarizeWarranty = summarizeWarranty;
const daysUntil = (date) => Math.ceil((date.getTime() - Date.now()) / exports.DAY_MS);
exports.daysUntil = daysUntil;
