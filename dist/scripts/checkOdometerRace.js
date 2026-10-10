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
var _a, _b, _c;
/**
 * Spec 49 regression guard for DEF-01 (lost-update race on the bike odometer).
 *
 * For each trial: create a throwaway bike at odometer 0, fire N concurrent
 * `POST /bikes/:id/fuel-logs` with ascending readings, read the bike back and require
 * `currentOdometer` to equal the highest reading. Prints `parallel=N: X/Y trials wrong` and exits 1
 * if any trial is wrong. Each trial's bike is soft-deleted afterwards.
 *
 * MANUAL VERIFICATION TOOL — it creates data. Only point it at a local server or a throwaway
 * account; never at a real user's account. Not part of `yarn build` output you should rely on.
 *
 * Usage:
 *   RACE_EMAIL=you@example.com RACE_PASSWORD=secret \
 *     npx ts-node --transpile-only src/scripts/checkOdometerRace.ts
 *
 * Env:
 *   BASE_URL       default http://localhost:5000/api
 *   RACE_EMAIL / RACE_PASSWORD   an existing account (registered as a convenience if missing)
 *   TRIALS         default 8
 *   PARALLEL       default "5,20" (comma separated)
 *
 * Dates are strictly ascending with the readings on purpose: since spec 48 the server rejects a
 * reading that goes backwards in date order, and that rejection must not be mistaken for a race.
 */
/* eslint-disable no-console */
const BASE_URL = ((_a = process.env.BASE_URL) !== null && _a !== void 0 ? _a : "http://localhost:5000/api").replace(/\/$/, "");
const EMAIL = process.env.RACE_EMAIL;
const PASSWORD = process.env.RACE_PASSWORD;
const TRIALS = Number((_b = process.env.TRIALS) !== null && _b !== void 0 ? _b : 8);
const PARALLEL = ((_c = process.env.PARALLEL) !== null && _c !== void 0 ? _c : "5,20").split(",").map((n) => Number(n.trim()));
const api = (method, path, token, body) => __awaiter(void 0, void 0, void 0, function* () {
    const res = yield fetch(BASE_URL + path, {
        method,
        headers: Object.assign({ "content-type": "application/json" }, (token ? { authorization: `Bearer ${token}` } : {})),
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (yield res.json().catch(() => null)) };
});
const login = () => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    let res = yield api("POST", "/auth/login", undefined, { email: EMAIL, password: PASSWORD });
    if (res.status !== 200) {
        yield api("POST", "/auth/register", undefined, { name: "Race Check", email: EMAIL, password: PASSWORD });
        res = yield api("POST", "/auth/login", undefined, { email: EMAIL, password: PASSWORD });
    }
    if (!((_a = res.json) === null || _a === void 0 ? void 0 : _a.token))
        throw new Error(`Login failed (${res.status})`);
    return res.json.token;
});
const runTrial = (token, parallel) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    const created = yield api("POST", "/bikes", token, {
        nickname: "RaceCheck",
        brand: "Race",
        model: "Check",
        registrationNumber: `RACE-${Math.random().toString(36).slice(2, 10)}`,
        purchaseDate: "2024-01-01",
        fuelTankCapacityLiters: 10,
        currentOdometer: 0,
    });
    const bikeId = (_b = (_a = created.json) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b._id;
    if (!bikeId)
        throw new Error(`Bike create failed (${created.status}): ${JSON.stringify(created.json)}`);
    try {
        const posts = yield Promise.all(Array.from({ length: parallel }, (_, i) => api("POST", `/bikes/${bikeId}/fuel-logs`, token, {
            odometerReading: 100 + i * 10,
            litersAdded: 5,
            isFullTank: false,
            pricePerLiter: 100,
            date: `2025-01-${String(i + 1).padStart(2, "0")}`,
        })));
        const rejected = posts.filter((p) => p.status !== 201);
        if (rejected.length) {
            // a rejected save is a harness problem, not evidence about the race — fail loudly
            throw new Error(`${rejected.length}/${parallel} fuel-log saves were not 201 (first: ${rejected[0].status} ${JSON.stringify(rejected[0].json)})`);
        }
        const highest = 100 + (parallel - 1) * 10;
        const bike = yield api("GET", `/bikes/${bikeId}`, token);
        return ((_d = (_c = bike.json) === null || _c === void 0 ? void 0 : _c.data) === null || _d === void 0 ? void 0 : _d.currentOdometer) === highest;
    }
    finally {
        yield api("DELETE", `/bikes/${bikeId}`, token);
    }
});
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!EMAIL || !PASSWORD)
            throw new Error("Set RACE_EMAIL and RACE_PASSWORD (a throwaway account).");
        console.log(`checkOdometerRace — ${BASE_URL}, ${TRIALS} trials per level\n`);
        const token = yield login();
        let anyWrong = false;
        for (const parallel of PARALLEL) {
            let wrong = 0;
            for (let t = 0; t < TRIALS; t++) {
                if (!(yield runTrial(token, parallel)))
                    wrong++;
            }
            anyWrong = anyWrong || wrong > 0;
            console.log(`parallel=${parallel}: ${wrong}/${TRIALS} trials ended with a wrong (too low) odometer`);
        }
        if (anyWrong)
            process.exitCode = 1;
    });
}
main().catch((e) => {
    console.error(`\n${e.message}`);
    process.exitCode = 1;
});
