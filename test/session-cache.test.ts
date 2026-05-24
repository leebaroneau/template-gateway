import { describe, expect, it, vi } from "vitest";
import { SessionCache } from "../src/session-cache.js";

function makeFactory(returns: { url: string; headers?: Record<string, string>; ttlSeconds?: number }) {
  return vi.fn(async () => ({
    url: returns.url,
    headers: returns.headers ?? { "x-api-key": "ak_test" },
    ttlSeconds: returns.ttlSeconds
  }));
}

describe("SessionCache", () => {
  it("creates a session on first get and reuses on second", async () => {
    const factory = makeFactory({ url: "https://example/mcp/session-a" });
    const cache = new SessionCache(factory, { ttlSeconds: 60 });

    const a = await cache.get("user_1");
    const b = await cache.get("user_1");

    expect(a.url).toBe("https://example/mcp/session-a");
    expect(a).toBe(b);
    expect(factory).toHaveBeenCalledOnce();
  });

  it("refreshes the session after expiry", async () => {
    let now = 1000;
    const factory = vi.fn(async () => ({
      url: `https://example/mcp/${factory.mock.calls.length}`,
      headers: {}
    }));
    const cache = new SessionCache(factory, { ttlSeconds: 60, now: () => now });

    const first = await cache.get("user_1");
    now += 70_000;
    const second = await cache.get("user_1");

    expect(first.url).not.toBe(second.url);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent gets for the same user", async () => {
    const factory = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { url: "https://example/mcp/session", headers: {} };
    });
    const cache = new SessionCache(factory, { ttlSeconds: 60 });

    const [a, b, c] = await Promise.all([cache.get("user_1"), cache.get("user_1"), cache.get("user_1")]);

    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(factory).toHaveBeenCalledOnce();
  });

  it("invalidate forces re-creation on next get", async () => {
    const factory = vi.fn(async () => ({
      url: `https://example/mcp/${factory.mock.calls.length}`,
      headers: {}
    }));
    const cache = new SessionCache(factory, { ttlSeconds: 60 });

    const first = await cache.get("user_1");
    cache.invalidate("user_1");
    const second = await cache.get("user_1");

    expect(first.url).not.toBe(second.url);
  });

  it("evicts the oldest entry when bounded LRU is exceeded", async () => {
    const factory = vi.fn(async (userId: string) => ({
      url: `https://example/mcp/${userId}`,
      headers: {}
    }));
    const cache = new SessionCache(factory, { ttlSeconds: 60, maxEntries: 2 });

    await cache.get("user_1");
    await cache.get("user_2");
    await cache.get("user_3");

    expect(cache.size()).toBe(2);
    // user_1 should have been evicted; getting it again triggers a fresh factory call
    await cache.get("user_1");
    expect(factory).toHaveBeenCalledTimes(4);
  });
});
