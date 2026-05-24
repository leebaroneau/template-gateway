export interface SessionEntry {
  url: string;
  headers: Record<string, string>;
  expiresAt: number;
}

export interface SessionFactory {
  (userId: string): Promise<{ url: string; headers: Record<string, string>; ttlSeconds?: number }>;
}

interface CacheOptions {
  ttlSeconds: number;
  maxEntries?: number;
  now?: () => number;
}

/**
 * In-memory cache keyed by Composio user_id. Bounded LRU with TTL.
 * Cold start rebuilds on first request per user — Composio Tool Router
 * sessions are cheap to create.
 */
export class SessionCache {
  private readonly entries = new Map<string, SessionEntry>();
  private readonly factory: SessionFactory;
  private readonly ttlSeconds: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly inflight = new Map<string, Promise<SessionEntry>>();

  constructor(factory: SessionFactory, options: CacheOptions) {
    this.factory = factory;
    this.ttlSeconds = options.ttlSeconds;
    this.maxEntries = options.maxEntries ?? 256;
    this.now = options.now ?? (() => Date.now());
  }

  async get(userId: string): Promise<SessionEntry> {
    const existing = this.entries.get(userId);
    if (existing && existing.expiresAt > this.now()) {
      // Touch for LRU ordering.
      this.entries.delete(userId);
      this.entries.set(userId, existing);
      return existing;
    }

    const pending = this.inflight.get(userId);
    if (pending) return pending;

    const promise = this.refresh(userId);
    this.inflight.set(userId, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(userId);
    }
  }

  invalidate(userId: string): void {
    this.entries.delete(userId);
  }

  size(): number {
    return this.entries.size;
  }

  private async refresh(userId: string): Promise<SessionEntry> {
    const created = await this.factory(userId);
    const ttl = created.ttlSeconds ?? this.ttlSeconds;
    const entry: SessionEntry = {
      url: created.url,
      headers: created.headers,
      expiresAt: this.now() + ttl * 1000
    };
    this.entries.set(userId, entry);
    this.evictIfNeeded();
    return entry;
  }

  private evictIfNeeded(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) return;
      this.entries.delete(oldestKey);
    }
  }
}
