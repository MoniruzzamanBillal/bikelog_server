import { Router } from "express";
import adminCheck from "../../middleware/adminCheck";
import authCheck from "../../middleware/authCheck";
import { errorLogController } from "./errorLog.controller";

const router = Router();

router.get("/", authCheck, adminCheck, errorLogController.getErrorLogs);

router.get("/:id", authCheck, adminCheck, errorLogController.getErrorLogById);

export const errorLogRouter = router;
