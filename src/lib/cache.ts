/**
 * Tiny in-memory TTL cache for serverless route handlers.
 * Survives warm invocations on a single instance; combined with region pinning
 * and query-count reduction this removes most repeated work.
 */
const store = new Map<string, { value: unknown; at: number }>();

export function cached<T>(key: string, ttlMs: number): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > ttlMs) {
    store.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function setCache(key: string, value: unknown): void {
  if (store.size > 500) store.clear(); // keep memory bounded
  store.set(key, { value, at: Date.now() });
}

/** Cache-aside helper: returns cached value or computes, stores and returns it. */
export async function remember<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cached<T>(key, ttlMs);
  if (hit !== undefined) return hit;
  const value = await fn();
  setCache(key, value);
  return value;
}
