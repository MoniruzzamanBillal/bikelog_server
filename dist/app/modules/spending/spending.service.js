"use strict";
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
exports.spendingServices = void 0;
// TODO: implement spending summary — aggregates FuelLog.totalCost + MaintenanceLog.cost for
// bikeId via the JS filter/reduce style (bike-log-plan.md §2.3, context/architecture.md invariant 6)
const getSpendingSummaryFromDB = (bikeId, period) => __awaiter(void 0, void 0, void 0, function* () {
    return { bikeId, period };
});
//
exports.spendingServices = {
    getSpendingSummaryFromDB,
};
