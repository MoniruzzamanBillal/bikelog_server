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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_status_1 = __importDefault(require("http-status"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = __importDefault(require("../config"));
const AppError_1 = __importDefault(require("../Error/AppError"));
const catchAsync_1 = __importDefault(require("../util/catchAsync"));
const authCheck = (0, catchAsync_1.default)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    const header = req.headers.authorization;
    if (!header) {
        return next(new AppError_1.default(http_status_1.default.UNAUTHORIZED, "Authorization header missing or malformed"));
    }
    const token = header.split(" ")[1];
    // ! Spec 51a: verified into the WIDER claims type, not TJwtPayload. The caller supplies the
    // ! token, so `type` is an arbitrary string until checked below — asserting it as the
    // ! "access" literal this server mints would make that check provably dead code (it did:
    // ! TS2367), while compiling the check away would leave H4 unenforced at runtime.
    let decoded;
    try {
        decoded = jsonwebtoken_1.default.verify(token, config_1.default.jwt_secret);
    }
    catch (error) {
        // ! Spec 51: both branches are still 401, so no client behaviour changes — but the message
        // ! now tells an expired token apart from a malformed one, which is what the clients' 401
        // ! handling and the error log are read against. An expired access token is the routine
        // ! case now (15-minute lifetime), not a fault.
        return next(new AppError_1.default(http_status_1.default.UNAUTHORIZED, error instanceof jsonwebtoken_1.default.TokenExpiredError
            ? "Access token expired"
            : "Invalid access token"));
    }
    // ! Spec 51 §0 H4: a refresh token must never authenticate a request. It verifies with a
    // ! different secret so it would normally fail above, but this is the explicit second half
    // ! of that defence and it costs nothing. A MISSING `type` passes deliberately (H8) —
    // ! tokens issued before spec 51 have no such claim and must keep working until they expire.
    if ((decoded === null || decoded === void 0 ? void 0 : decoded.type) === "refresh") {
        return next(new AppError_1.default(http_status_1.default.UNAUTHORIZED, "Invalid access token"));
    }
    // ! Sound only because the check above ruled out the one `type` value TJwtPayload must
    // ! never carry (spec 51a).
    req.user = decoded;
    next();
}));
exports.default = authCheck;
