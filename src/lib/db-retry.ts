/**
 * Retries transient database failures (pooler hiccups, brief network blips)
 * so a rare blip never surfaces as a 500 to the user.
 */
const TRANSIENT = [
  "Can't reach database server",
  "Connection reset",
  "ECONNRESET",
  "ETIMEDOUT",
  "P1001",
  "P1002",
  "P1008",
  "P2024",
  "Timed out fetching",
  "Server has closed the connection",
];

function isTransient(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string })?.code;
  if (code && TRANSIENT.includes(code)) return true;
  return TRANSIENT.some((t) => msg.includes(t));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withDbRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 250): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isTransient(e) || i === attempts - 1) throw e;
      console.warn(`[db] transient failure (attempt ${i + 1}/${attempts}), retrying:`, (e as Error).message?.split("\n")[0]);
      await sleep(delayMs * (i + 1));
    }
  }
  throw lastErr;
}
