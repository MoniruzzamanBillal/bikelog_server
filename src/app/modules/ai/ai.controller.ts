import httpStatus from "http-status";
import catchAsync from "../../util/catchAsync";
import sendResponse from "../../util/sendResponse";
import { aiServices } from "./ai.service";

const getSpendingInsight = catchAsync(async (req, res) => {
  const result = await aiServices.getSpendingInsightFromDB(
    req.params.bikeId,
    req.user.userId,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Spending insight retrieved successfully",
    data: result,
  });
});

const getMileageInsight = catchAsync(async (req, res) => {
  const result = await aiServices.getMileageInsightFromDB(
    req.params.bikeId,
    req.user.userId,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Mileage insight retrieved successfully",
    data: result,
  });
});

const bikeChat = catchAsync(async (req, res) => {
  const result = await aiServices.getBikeChatReply(
    req.params.bikeId,
    req.user.userId,
    req.body.messages,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Bike chat reply generated successfully",
    data: result,
  });
});

export const aiController = {
  getSpendingInsight,
  getMileageInsight,
  bikeChat,
};
