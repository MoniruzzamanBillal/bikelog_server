import { defineConfig } from "vitest/config";

// ! Unit tests only, and deliberately so (spec 66). The PrismaNeon adapter cannot point at a
// ! local Postgres, so anything that touches `prisma` needs a live Neon branch and is out of
// ! scope here — these cover the pure, DB-free logic (error mappers, the list-query builder).
// ! Tests live in `tests/`, outside `src`, so `tsc` (`include: ["src"]`) never compiles them
// ! into `dist`.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
