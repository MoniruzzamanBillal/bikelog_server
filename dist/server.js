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
/* eslint-disable no-console */
const app_1 = __importDefault(require("./app"));
const config_1 = __importDefault(require("./app/config"));
const prisma_1 = require("./app/lib/prisma");
// import { Server } from "http";
// let server: Server;
// async function Main() {
//   try {
//     await mongoose.connect(config.mongo_database_url as string);
//     app.listen(config.port, () => {
//       console.log(`listening from port ${config.port}`);
//     });
//   } catch (error) {
//     console.log(error);
//   }
// }
// Main();
// ! Spec 51 §B — fail at boot, not per request. A missing refresh secret would otherwise
// ! make every login throw from `Jwt.sign(payload, undefined)`, and a refresh secret EQUAL to
// ! the access secret would make an access token a structurally valid refresh token, replayable
// ! for a new access token forever (§0 H4). Both are configuration mistakes with no safe
// ! runtime behaviour, and this is the only cheap place to notice them.
// ! Deliberately OUTSIDE Main()'s try/catch, which swallows everything into a console.log —
// ! a throw in there would leave the process alive and silently not listening.
// ! DEPLOY NOTE: JWT_REFRESH_SECRET must exist in the environment BEFORE this code is
// ! deployed. On Vercel a throw at module scope fails the function's initialisation, so every
// ! request 500s until the variable is set — which is the intended loud failure, but it does
// ! mean the variable comes first. See §H's "Before merge".
function assertJwtSecrets() {
    if (!config_1.default.jwt_refresh_secret) {
        throw new Error("JWT_REFRESH_SECRET is not set. Refresh tokens cannot be signed or verified without it (spec 51 §B).");
    }
    if (config_1.default.jwt_refresh_secret === config_1.default.jwt_secret) {
        throw new Error("JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET — with one shared secret an access token is a valid refresh token (spec 51 §0 H4).");
    }
}
assertJwtSecrets();
function Main() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield prisma_1.prisma.$connect();
            app_1.default.listen(config_1.default.port, () => {
                console.log(`listening from port ${config_1.default.port}`);
            });
        }
        catch (error) {
            console.log(error);
        }
    });
}
Main();
// process.on("unhandledRejection", () => {
//   console.log("unhandledRejection detected , shutting down !!! ");
//   if (server) {
//     server.close(() => {
//       process.exit(1);
//     });
//   }
//   process.exit(1);
// });
// process.on("uncaughtException", () => {
//   console.log("uncaughtException detected , shutting down !!! ");
//   process.exit(1);
// });
