import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Browser specs belong to Playwright; generated dist-types must not run
    // a second copy of the source tests after a production build.
    include: ["packages/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-types/**"],
  },
});
