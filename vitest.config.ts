import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "tests/unit/**/*.test.ts"],
    testTimeout: 60000,
  },
});
