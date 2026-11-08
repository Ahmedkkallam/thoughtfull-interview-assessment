import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// scrypt is built into Node (no native build). Parameters are stored with each hash,
// so they can be raised later without breaking existing accounts.
// Production cost is 2^15. Tests lower it via SCRYPT_N because they sign up hundreds of users;
// stored hashes carry their own N, so verification works at any cost.
export const DEFAULT_N = 2 ** 15;
// Only a power of 2 from 2^10 to 2^20 is valid; a typo fails at startup instead of silently weakening hashes.
export function parseScryptN(value: string | undefined): number {
  if (value === undefined || value === "") return DEFAULT_N;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 2 ** 10 || n > 2 ** 20 || (n & (n - 1)) !== 0) {
    throw new Error(`SCRYPT_N must be a power of 2 between 1024 and 1048576, got "${value}"`);
  }
  return n;
}
const N = parseScryptN(process.env.SCRYPT_N);
const r = 8;
const p = 1;
const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  // scrypt needs 128 * N * r bytes (32 MiB here); Node's default limit is exactly 32 MiB, so raise it.
  const maxmem = 2 * 128 * (options.N ?? N) * (options.r ?? r);
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LENGTH, { ...options, maxmem }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

// Format: scrypt$N$r$p$<salt base64>$<hash base64>
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, { N, r, p });
  return ["scrypt", N, r, p, salt.toString("base64"), hash.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, rr, pp, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"), { N: Number(n), r: Number(rr), p: Number(pp) });
  // Constant-time comparison: response time does not reveal how many bytes matched.
  // (timingSafeEqual throws on different lengths, e.g. a corrupted stored hash.)
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
