// TODO: implement spending summary — aggregates FuelLog.totalCost + MaintenanceLog.cost for
// bikeId via the JS filter/reduce style (bike-log-plan.md §2.3, context/architecture.md invariant 6)
const getSpendingSummaryFromDB = async (
  bikeId: string,
  period: string | undefined,
) => {
  return { bikeId, period };
};

//
export const spendingServices = {
  getSpendingSummaryFromDB,
};
