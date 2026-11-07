import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "domain",
          root: "packages/domain",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "api",
          root: "apps/api",
          include: ["test/**/*.test.ts"],
          globalSetup: ["test/global-setup.ts"],
          fileParallelism: false,
        },
      },
      // Add a "web" project here (jsdom) when apps/web exists.
    ],
  },
});
