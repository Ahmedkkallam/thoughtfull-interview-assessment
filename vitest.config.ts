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
          // Test files run one after another against one database, so share the loaded modules instead of re-importing the app for each file.
          isolate: false,
          // Vitest requires a distinct group when projects differ in worker settings.
          sequence: { groupOrder: 1 },
          // Real-Postgres race tests sign up many users (scrypt) and run requests concurrently; 5 s is tight on a busy machine.
          testTimeout: 15_000,
          // Cheap password hashing for tests only; the production default is 2^15 (see auth/password.ts).
          env: { SCRYPT_N: String(2 ** 10) },
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
