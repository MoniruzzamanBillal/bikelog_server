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
const BASE_URL = (process.env.BASE_URL ?? "http://localhost:5000/api").replace(/\/$/, "");
const EMAIL = process.env.RACE_EMAIL;
const PASSWORD = process.env.RACE_PASSWORD;
const TRIALS = Number(process.env.TRIALS ?? 8);
const PARALLEL = (process.env.PARALLEL ?? "5,20").split(",").map((n) => Number(n.trim()));

type ApiBody = { token?: string; data?: { _id?: string; currentOdometer?: number } };
type Res = { status: number; json: ApiBody | null };

const api = async (method: string, path: string, token?: string, body?: unknown): Promise<Res> => {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as ApiBody | null };
};

const login = async (): Promise<string> => {
  let res = await api("POST", "/auth/login", undefined, { email: EMAIL, password: PASSWORD });
  if (res.status !== 200) {
    await api("POST", "/auth/register", undefined, { name: "Race Check", email: EMAIL, password: PASSWORD });
    res = await api("POST", "/auth/login", undefined, { email: EMAIL, password: PASSWORD });
  }
  if (!res.json?.token) throw new Error(`Login failed (${res.status})`);
  return res.json.token;
};

const runTrial = async (token: string, parallel: number): Promise<boolean> => {
  const created = await api("POST", "/bikes", token, {
    nickname: "RaceCheck",
    brand: "Race",
    model: "Check",
    registrationNumber: `RACE-${Math.random().toString(36).slice(2, 10)}`,
    purchaseDate: "2024-01-01",
    fuelTankCapacityLiters: 10,
    currentOdometer: 0,
  });
  const bikeId: string | undefined = created.json?.data?._id;
  if (!bikeId) throw new Error(`Bike create failed (${created.status}): ${JSON.stringify(created.json)}`);

  try {
    const posts = await Promise.all(
      Array.from({ length: parallel }, (_, i) =>
        api("POST", `/bikes/${bikeId}/fuel-logs`, token, {
          odometerReading: 100 + i * 10,
          litersAdded: 5,
          isFullTank: false,
          pricePerLiter: 100,
          date: `2025-01-${String(i + 1).padStart(2, "0")}`,
        }),
      ),
    );
    const rejected = posts.filter((p) => p.status !== 201);
    if (rejected.length) {
      // a rejected save is a harness problem, not evidence about the race — fail loudly
      throw new Error(`${rejected.length}/${parallel} fuel-log saves were not 201 (first: ${rejected[0].status} ${JSON.stringify(rejected[0].json)})`);
    }

    const highest = 100 + (parallel - 1) * 10;
    const bike = await api("GET", `/bikes/${bikeId}`, token);
    return bike.json?.data?.currentOdometer === highest;
  } finally {
    await api("DELETE", `/bikes/${bikeId}`, token);
  }
};

async function main() {
  if (!EMAIL || !PASSWORD) throw new Error("Set RACE_EMAIL and RACE_PASSWORD (a throwaway account).");
  console.log(`checkOdometerRace — ${BASE_URL}, ${TRIALS} trials per level\n`);

  const token = await login();
  let anyWrong = false;

  for (const parallel of PARALLEL) {
    let wrong = 0;
    for (let t = 0; t < TRIALS; t++) {
      if (!(await runTrial(token, parallel))) wrong++;
    }
    anyWrong = anyWrong || wrong > 0;
    console.log(`parallel=${parallel}: ${wrong}/${TRIALS} trials ended with a wrong (too low) odometer`);
  }

  if (anyWrong) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`\n${(e as Error).message}`);
  process.exitCode = 1;
});
