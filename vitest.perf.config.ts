import { defineConfig } from "vitest/config";
/** The performance ratchet runs on its own, after the suite: timings measured beside other test workers are not timings of the tool. */
export default defineConfig({
  test: {
    include: ["test/perf/**/*.test.ts"],
    globalSetup: ["./test/build.ts"],
    fileParallelism: false,
    passWithNoTests: false,
  },
});
