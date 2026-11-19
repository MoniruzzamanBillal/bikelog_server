"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getServiceRemindersFromDB = void 0;
const prisma_1 = require("../../lib/prisma");
const serviceLog_pure_1 = require("./serviceLog.pure");
// Re-export every pure helper so existing import sites (`./serviceLog.utils`) keep working;
// the pure ones live in serviceLog.pure (no Prisma import) so the unit suite can reach them.
__exportStar(require("./serviceLog.pure"), exports);
// ! Lives here (prisma-touching util) exactly like engineOilLog.utils' findLatestEngineOilLog,
// ! so getRemindersFromDB (maintenanceLog.service.ts §E) re-sources service reminders without
// ! the due arithmetic drifting between two files. Emits:
// !  - the EARLIEST upcoming service row that has a due date, and
// !  - every PENDING recommendation (done !== true) that has a target date,
// ! each overdue if past / upcoming if within 14 days, filtered to that window.
const getServiceRemindersFromDB = (bikeId, currentOdometer) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    const now = new Date();
    const reminders = [];
    const upcomingRows = yield prisma_1.prisma.serviceLog.findMany({
        where: {
            bikeId,
            isDeleted: false,
            status: "upcoming",
            dueDate: { not: null },
        },
        orderBy: { dueDate: "asc" },
    });
    const nextRow = upcomingRows[0];
    if (nextRow === null || nextRow === void 0 ? void 0 : nextRow.dueDate) {
        const daysRemaining = (0, serviceLog_pure_1.daysUntil)(nextRow.dueDate);
        const state = (0, serviceLog_pure_1.dueState)(nextRow.dueDate, now);
        if (state === "overdue" || daysRemaining <= serviceLog_pure_1.SERVICE_UPCOMING_DAYS) {
            reminders.push({
                maintenanceType: {
                    _id: nextRow.id,
                    name: nextRow.serviceKind === "warranty"
                        ? `Warranty service #${(_a = nextRow.warrantyNumber) !== null && _a !== void 0 ? _a : ""}`.trim()
                        : "Next service",
                },
                lastServiceDate: nextRow.dueDate,
                lastOdometerReading: currentOdometer,
                nextDueDate: nextRow.dueDate,
                daysRemaining,
                status: state,
            });
        }
    }
    // Pending recommendations with a target date, across every live service row. (No JSON
    // not-null filter — Prisma's JSON filters don't take a plain null, and a per-bike service
    // list is small enough to scan in JS, which the loop below does anyway.)
    const rowsWithRecs = yield prisma_1.prisma.serviceLog.findMany({
        where: {
            bikeId,
            isDeleted: false,
        },
        orderBy: { createdAt: "desc" },
    });
    for (const row of rowsWithRecs) {
        const recs = (_b = row.recommendations) !== null && _b !== void 0 ? _b : [];
        for (const rec of recs) {
            if ((rec === null || rec === void 0 ? void 0 : rec.done) === true || (rec === null || rec === void 0 ? void 0 : rec.targetDate) == null)
                continue;
            const target = new Date(rec.targetDate);
            if (Number.isNaN(target.getTime()))
                continue;
            const daysRemaining = (0, serviceLog_pure_1.daysUntil)(target);
            const state = (0, serviceLog_pure_1.dueState)(target, now);
            if (state !== "overdue" && daysRemaining > serviceLog_pure_1.SERVICE_UPCOMING_DAYS)
                continue;
            reminders.push({
                maintenanceType: {
                    _id: (_c = rec.id) !== null && _c !== void 0 ? _c : `${row.id}-rec`,
                    name: rec.text,
                },
                lastServiceDate: (_d = row.serviceDate) !== null && _d !== void 0 ? _d : row.createdAt,
                lastOdometerReading: currentOdometer,
                nextDueDate: target,
                daysRemaining,
                status: state,
            });
        }
    }
    return reminders;
});
exports.getServiceRemindersFromDB = getServiceRemindersFromDB;
