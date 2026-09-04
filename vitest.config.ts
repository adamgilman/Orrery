import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    globalSetup: ["./test/build.ts"],
    passWithNoTests: false,
  },
});
