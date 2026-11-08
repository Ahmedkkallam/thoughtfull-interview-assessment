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
          // Real-Postgres race tests sign up many users (scrypt) and run requests concurrently; 5 s is tight on a busy machine.
          testTimeout: 15_000,
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
