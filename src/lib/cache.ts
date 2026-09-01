/**
 * Swappable cache abstraction. In-memory implementation for now; a file- or
 * database-backed implementation can drop in later behind the same interface.
 */
export interface Cache<V = unknown> {
  get(key: string): Promise<V | undefined>;
  set(key: string, value: V, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

interface Entry<V> {
  value: V;
  expiresAt?: number;
}

export class InMemoryCache<V = unknown> implements Cache<V> {
  private store = new Map<string, Entry<V>>();

  async get(key: string): Promise<V | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: V, ttlMs?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

// One process-wide cache instance per cache "namespace" (track context, summaries, ...).
// Kept in a module-level map so Next.js route handlers sharing the same server process
// reuse the same cache instead of creating a new one per request.
const namespacedCaches = new Map<string, InMemoryCache<unknown>>();

export function getCache<V = unknown>(namespace: string): Cache<V> {
  let cache = namespacedCaches.get(namespace);
  if (!cache) {
    cache = new InMemoryCache<unknown>();
    namespacedCaches.set(namespace, cache);
  }
  return cache as Cache<V>;
}
