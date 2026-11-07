import pg from "pg";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://thoughtfull:thoughtfull@localhost:54329/thoughtfull_test";

// max 20 so race tests can hold many concurrent connections.
export function createTestPool() {
  return new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 20 });
}
