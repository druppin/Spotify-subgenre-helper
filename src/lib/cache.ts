import { promises as fs } from "fs";
import path from "path";

/**
 * Swappable cache abstraction. File-backed by default (see FileCache) so
 * track context / AI summaries survive a dev-server restart; a database-
 * backed implementation can drop in later behind the same interface.
 */
export interface Cache<V = unknown> {
  get(key: string): Promise<V | undefined>;
  set(key: string, value: V, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  // Every unexpired entry, for building lookups across a whole namespace.
  entries(): Promise<[string, V][]>;
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

  async entries(): Promise<[string, V][]> {
    const now = Date.now();
    return [...this.store].filter(([, e]) => !e.expiresAt || e.expiresAt >= now).map(([k, e]) => [k, e.value]);
  }
}

const CACHE_DIR = path.join(process.cwd(), ".cache");

/**
 * One JSON file per namespace under .cache/. Simple, human-inspectable,
 * fine for a single-user local tool — not meant to survive concurrent
 * writers, which a personal dev server never has.
 */
export class FileCache<V = unknown> implements Cache<V> {
  private filePath: string;
  private loaded: Map<string, Entry<V>> | null = null;

  constructor(namespace: string) {
    this.filePath = path.join(CACHE_DIR, `${namespace}.json`);
  }

  private async load(): Promise<Map<string, Entry<V>>> {
    if (this.loaded) return this.loaded;
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      this.loaded = new Map(Object.entries(JSON.parse(raw) as Record<string, Entry<V>>));
    } catch {
      this.loaded = new Map();
    }
    return this.loaded;
  }

  private async persist(map: Map<string, Entry<V>>): Promise<void> {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(Object.fromEntries(map), null, 2), "utf-8");
  }

  async get(key: string): Promise<V | undefined> {
    const map = await this.load();
    const entry = map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      map.delete(key);
      await this.persist(map);
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: V, ttlMs?: number): Promise<void> {
    const map = await this.load();
    map.set(key, { value, expiresAt: ttlMs ? Date.now() + ttlMs : undefined });
    await this.persist(map);
  }

  async delete(key: string): Promise<void> {
    const map = await this.load();
    map.delete(key);
    await this.persist(map);
  }

  async entries(): Promise<[string, V][]> {
    const map = await this.load();
    const now = Date.now();
    return [...map].filter(([, e]) => !e.expiresAt || e.expiresAt >= now).map(([k, e]) => [k, e.value]);
  }
}

// One process-wide cache instance per cache "namespace" (track context, summaries, ...).
// Kept in a module-level map so Next.js route handlers sharing the same server process
// reuse the same cache instead of creating a new one per request.
const namespacedCaches = new Map<string, Cache<unknown>>();

export function getCache<V = unknown>(namespace: string): Cache<V> {
  let cache = namespacedCaches.get(namespace);
  if (!cache) {
    cache = new FileCache<unknown>(namespace);
    namespacedCaches.set(namespace, cache);
  }
  return cache as Cache<V>;
}
