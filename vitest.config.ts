import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "test/orrery/**/*.test.ts"], // test/perf runs alone: vitest.perf.config.ts
    globalSetup: ["./test/build.ts"],
    passWithNoTests: false,
  },
});
