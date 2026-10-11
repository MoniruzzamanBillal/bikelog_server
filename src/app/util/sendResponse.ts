import { Response } from "express";

type Tresponse<T> = {
  status: number;
  success: boolean;
  message: string;
  data: T;
  // ! `token` is the ACCESS token (spec 51 kept the name for client back-compat). Both are
  // ! optional and serialise to absent for every endpoint that doesn't set them, exactly as
  // ! `token` already did before refresh tokens existed.
  token?: string;
  refreshToken?: string;
};

const sendResponse = <T>(res: Response, data: Tresponse<T>) => {
  res.status(data.status).json({
    success: data.success,
    message: data.message,
    data: data.data,
    token: data.token,
    refreshToken: data.refreshToken,
  });
};

export default sendResponse;
