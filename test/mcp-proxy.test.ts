import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { SessionCache } from "../src/session-cache.js";
import { forwardJsonRpc } from "../src/mcp-proxy.js";
import { actorContext, bearerAuth } from "../src/auth.js";

function buildApp(opts: { fetchImpl: typeof fetch; bearer?: string }) {
  const cache = new SessionCache(
    vi.fn(async () => ({ url: "https://upstream/mcp/session", headers: { "x-api-key": "ak_test" } })),
    { ttlSeconds: 60 }
  );
  const app = express();
  app.disable("x-powered-by");
  const router = express.Router();
  router.use(express.json());
  router.use(bearerAuth(opts.bearer ?? "a_secret_thats_long_enough"));
  router.use(actorContext("brand-default"));
  router.post("/", (req, res) => forwardJsonRpc(req, res, { cache, fetchImpl: opts.fetchImpl }));
  app.use("/mcp", router);
  return { app, cache };
}

function makeFetch(response: { status: number; body: string; headers?: Record<string, string> }): typeof fetch {
  return vi.fn(async () =>
    new Response(response.body, {
      status: response.status,
      headers: response.headers ?? { "content-type": "application/json" }
    })
  ) as unknown as typeof fetch;
}

describe("forwardJsonRpc", () => {
  it("forwards POST /mcp to the cached upstream and returns its body", async () => {
    const upstreamFetch = makeFetch({
      status: 200,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } })
    });
    const { app } = buildApp({ fetchImpl: upstreamFetch });

    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer a_secret_thats_long_enough")
      .set("X-Composio-User-Id", "user-marketing")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jsonrpc: "2.0", id: 1, result: { tools: [] } });
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  it("returns 502 when the upstream fetch throws", async () => {
    const upstreamFetch = (vi.fn(async () => {
      throw new Error("network down");
    }) as unknown) as typeof fetch;
    const { app, cache } = buildApp({ fetchImpl: upstreamFetch });
    const invalidateSpy = vi.spyOn(cache, "invalidate");

    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer a_secret_thats_long_enough")
      .set("X-Composio-User-Id", "user-marketing")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: expect.stringContaining("unreachable") });
    expect(invalidateSpy).toHaveBeenCalledWith("user-marketing");
  });

  it("rejects without bearer auth", async () => {
    const upstreamFetch = makeFetch({ status: 200, body: "{}" });
    const { app } = buildApp({ fetchImpl: upstreamFetch });

    const res = await request(app)
      .post("/mcp")
      .set("X-Composio-User-Id", "user-marketing")
      .send({});

    expect(res.status).toBe(401);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("returns 502 (does not crash) when the session factory throws", async () => {
    const upstreamFetch = makeFetch({ status: 200, body: "{}" });
    const failingFactory = vi.fn(async () => {
      throw new Error("Composio auth_configs missing for docusign");
    });
    const failingCache = new SessionCache(failingFactory, { ttlSeconds: 60 });
    const app = express();
    const router = express.Router();
    router.use(express.json());
    router.use(bearerAuth("a_secret_thats_long_enough"));
    router.use(actorContext("brand-default"));
    router.post("/", (req, res) => forwardJsonRpc(req, res, { cache: failingCache, fetchImpl: upstreamFetch }));
    app.use("/mcp", router);

    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer a_secret_thats_long_enough")
      .set("X-Composio-User-Id", "user-marketing")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: expect.stringContaining("session") });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("invalidates the cache on upstream 401", async () => {
    const upstreamFetch = makeFetch({ status: 401, body: '{"error":"unauthorized"}' });
    const { app, cache } = buildApp({ fetchImpl: upstreamFetch });
    const invalidateSpy = vi.spyOn(cache, "invalidate");

    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer a_secret_thats_long_enough")
      .set("X-Composio-User-Id", "user-marketing")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    expect(res.status).toBe(401);
    expect(invalidateSpy).toHaveBeenCalledWith("user-marketing");
  });

  it("does not route /mcp/v1 through the Composio proxy", async () => {
    const upstreamFetch = makeFetch({
      status: 200,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "upstream" }] } })
    });
    const { app } = buildApp({ fetchImpl: upstreamFetch });

    const res = await request(app)
      .post("/mcp/v1")
      .set("Authorization", "Bearer a_secret_thats_long_enough")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    expect(res.status).toBe(404);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});
