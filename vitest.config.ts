import react from "@vitejs/plugin-react";
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
      {
        plugins: [react()],
        test: {
          name: "web",
          root: "apps/web",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});
