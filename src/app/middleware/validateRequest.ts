import { NextFunction, Request, Response } from "express";
import { AnyZodObject } from "zod";
import catchAsync from "../util/catchAsync";

const validateRequest = (Schema: AnyZodObject) => {
  return catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const parsed = await Schema.parseAsync({
      body: req.body,
    });
    // ! reassign the parsed result back onto req.body — zod strips unrecognized keys by
    // ! default, but that only takes effect if the parsed output is actually used; without
    // ! this, unvalidated/extra client-supplied fields (e.g. isDeleted, owner) reach services untouched
    req.body = parsed.body;
    next();
  });
};
export default validateRequest;
