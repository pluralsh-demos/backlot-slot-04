import { Pool } from "pg";

export function readPoolMax(): number {
  const raw = process.env.POOL_MAX;
  if (raw === undefined || raw === "") return 8;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return 8;
  return parsed;
}

export function sqlStateOf(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = err.code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return "unknown";
}

const TRANSIENT_NETWORK_ERRORS = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
]);

function isTransientNetworkError(err: unknown): boolean {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = err.code;
    return typeof code === "string" && TRANSIENT_NETWORK_ERRORS.has(code);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry connection acquisition with bounded attempts and backoff.
 * Only retries transient Node network errors before any transaction work begins.
 */
export async function withConnectionRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  backoffMs = 100,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientNetworkError(error) || attempt === maxAttempts) {
        throw error;
      }
      await sleep(backoffMs);
    }
  }
  throw lastError;
}

/** Opens a pool when DATABASE_URL is set. Does not connect or run queries. */
export function createPool(onError: (err: Error) => void): Pool | undefined {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return undefined;

  const pool = new Pool({
    connectionString: databaseUrl,
    max: readPoolMax(),
  });
  pool.on("error", onError);
  return pool;
}
