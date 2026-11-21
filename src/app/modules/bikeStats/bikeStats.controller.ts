import httpStatus from "http-status";
import catchAsync from "../../util/catchAsync";
import sendResponse from "../../util/sendResponse";
import { bikeStatsServices } from "./bikeStats.service";

const getBikeStatStrip = catchAsync(async (req, res) => {
  const data = await bikeStatsServices.getBikeStatStripFromDB(
    req.params.bikeId,
    req.user.userId,
    req.query.targetMonth as string | undefined,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Bike stat strip retrieved",
    data,
  });
});

export const bikeStatsController = {
  getBikeStatStrip,
};
