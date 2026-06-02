import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminBackendError } from "../src/admin/backend-error.js";
import { DevApiGatewayBackend } from "../src/admin/dev-api-backend.js";
import { DevApiBrandsClient } from "../src/admin/dev-api-client.js";
import { createAdminRouter } from "../src/admin/routes.js";
import type { DevApiBrandsResponse } from "../src/admin/dev-api-types.js";
import type { GatewayConnectionBackend } from "../src/admin/types.js";

function devApiBrandsResponse(): DevApiBrandsResponse {
  return {
    brands: [
      {
        slug: "haverford",
        name: "Haverford",
        regions: [
          {
            region: "au",
            domain: "haverford.au",
            brand_alias: null,
            public: true,
            services: {
              shopify: {
                configured: true,
                shop_domain: "haverford-au.myshopify.com",
                display_name: "Haverford AU Shopify"
              }
            }
          }
        ]
      }
    ]
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("DevApiBrandsClient", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fetches internal brands from the Dev API with internal client headers", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(devApiBrandsResponse()));
    vi.stubGlobal("fetch", fetchMock);
    const client = new DevApiBrandsClient({
      baseUrl: "https://dev-api.haverford.au",
      clientId: "gateway-admin",
      clientSecret: "secret"
    });

    const response = await client.fetchBrands();

    expect(response).toEqual(devApiBrandsResponse());
    expect(fetchMock).toHaveBeenCalledWith("https://dev-api.haverford.au/api/internal/brands", {
      headers: {
        accept: "application/json",
        "x-internal-client-id": "gateway-admin",
        "x-internal-client-secret": "secret"
      },
      signal: expect.any(AbortSignal)
    });
  });

  it("normalizes a trailing slash in the base URL", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(devApiBrandsResponse()));
    vi.stubGlobal("fetch", fetchMock);
    const client = new DevApiBrandsClient({
      baseUrl: "https://dev-api.haverford.au/",
      clientId: "gateway-admin",
      clientSecret: "secret"
    });

    await client.fetchBrands();

    expect(fetchMock).toHaveBeenCalledWith("https://dev-api.haverford.au/api/internal/brands", expect.any(Object));
  });

  it("throws an admin backend error when the Dev API response is not OK", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream unavailable", { status: 503 })));
    const client = new DevApiBrandsClient({
      baseUrl: "https://dev-api.haverford.au",
      clientId: "gateway-admin",
      clientSecret: "secret"
    });

    await expect(client.fetchBrands()).rejects.toMatchObject({
      statusCode: 502,
      message: "Haverford Dev API /api/internal/brands failed with 503: upstream unavailable"
    });
  });

  it("sanitizes and bounds upstream error bodies in non-OK admin errors", async () => {
    const body = `client_secret=secret-token access_token=token-value ${"diagnostic ".repeat(80)}`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 500 })));
    const client = new DevApiBrandsClient({
      baseUrl: "https://dev-api.haverford.au",
      clientId: "gateway-admin",
      clientSecret: "secret"
    });

    let error: unknown;
    try {
      await client.fetchBrands();
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      statusCode: 502,
      message: expect.stringContaining("Haverford Dev API /api/internal/brands failed with 500:")
    });
    expect(error).toBeInstanceOf(AdminBackendError);
    const message = (error as Error).message;
    expect(message).toContain("[redacted]");
    expect(message).not.toContain("secret-token");
    expect(message).not.toContain("token-value");
    expect(message).not.toContain("client_secret");
    expect(message).not.toContain("access_token");
    expect(message.length).toBeLessThanOrEqual(260);
  });

  it("throws a 504 admin backend error when the Dev API fetch times out", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new DevApiBrandsClient({
      baseUrl: "https://dev-api.haverford.au",
      clientId: "gateway-admin",
      clientSecret: "secret",
      timeoutMs: 25
    });

    const promise = expect(client.fetchBrands()).rejects.toMatchObject({
      statusCode: 504,
      message: "Haverford Dev API /api/internal/brands timed out after 25ms"
    });
    await vi.advanceTimersByTimeAsync(25);

    await promise;
  });
});

describe("DevApiGatewayBackend", () => {
  it("returns mapped gateway state from the Dev API brands response", async () => {
    const backend = new DevApiGatewayBackend({
      fetchBrands: async () => devApiBrandsResponse()
    });

    const state = await backend.snapshot();

    expect(state.brands).toContainEqual({
      id: "brand_haverford",
      name: "Haverford",
      slug: "haverford",
      status: "active"
    });
    expect(state.regions).toContainEqual({
      id: "region_haverford_au",
      brandId: "brand_haverford",
      code: "AU",
      name: "AU",
      status: "active",
      domain: "haverford.au"
    });
    expect(state.connections).toContainEqual(
      expect.objectContaining({
        id: "devapi_haverford_au_shopify",
        displayName: "Haverford AU Shopify",
        configSummary: {
          shop_domain: "haverford-au.myshopify.com",
          display_name: "Haverford AU Shopify"
        }
      })
    );
  });

  it.each([
    ["createBrand", () => new DevApiGatewayBackend({ fetchBrands: async () => devApiBrandsResponse() }).createBrand({ name: "New Brand" })],
    [
      "createRegion",
      () =>
        new DevApiGatewayBackend({ fetchBrands: async () => devApiBrandsResponse() }).createRegion({
          brandId: "brand_haverford",
          code: "NZ",
          name: "New Zealand"
        })
    ],
    [
      "createConnection",
      () =>
        new DevApiGatewayBackend({ fetchBrands: async () => devApiBrandsResponse() }).createConnection({
          brandId: "brand_haverford",
          regionId: "region_haverford_au",
          connectorId: "connector_shopify",
          backendType: "internal",
          displayName: "Shopify"
        })
    ],
    [
      "updateBrand",
      () => new DevApiGatewayBackend({ fetchBrands: async () => devApiBrandsResponse() }).updateBrand("brand_haverford", { name: "Updated" })
    ],
    [
      "updateRegion",
      () => new DevApiGatewayBackend({ fetchBrands: async () => devApiBrandsResponse() }).updateRegion("region_haverford_au", { name: "Updated" })
    ],
    [
      "updateConnection",
      () =>
        new DevApiGatewayBackend({ fetchBrands: async () => devApiBrandsResponse() }).updateConnection("connection_1", {
          displayName: "Updated"
        })
    ],
    [
      "resetEntity",
      () =>
        new DevApiGatewayBackend({ fetchBrands: async () => devApiBrandsResponse() }).resetEntity({
          entityType: "brand",
          entityId: "brand_haverford"
        })
    ],
    ["testConnection", () => new DevApiGatewayBackend({ fetchBrands: async () => devApiBrandsResponse() }).testConnection("connection_1")],
    ["rotateApiKey", () => new DevApiGatewayBackend({ fetchBrands: async () => devApiBrandsResponse() }).rotateApiKey("client_1", "key_1")],
    ["revokeApiKey", () => new DevApiGatewayBackend({ fetchBrands: async () => devApiBrandsResponse() }).revokeApiKey("client_1", "key_1")]
  ])("rejects %s as read-only in Phase 1", async (_name, action) => {
    await expect(action()).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/^Dev API read-through mode is read-only in Phase 1; cannot .+\.$/)
    });
  });
});

describe("AdminBackendError", () => {
  it("exposes a typed admin status code", () => {
    const error = new AdminBackendError(409, "read-only");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AdminBackendError");
    expect(error.message).toBe("read-only");
    expect(error.statusCode).toBe(409);
  });
});

describe("admin route error statuses", () => {
  it("uses typed admin backend status codes in JSON error responses", async () => {
    const backend = {
      snapshot: async () => {
        throw new AdminBackendError(502, "upstream failed");
      },
      createBrand: async () => {
        throw new Error("unused");
      },
      createRegion: async () => {
        throw new Error("unused");
      },
      createConnection: async () => {
        throw new Error("unused");
      },
      updateBrand: async () => {
        throw new Error("unused");
      },
      updateRegion: async () => {
        throw new Error("unused");
      },
      updateConnection: async () => {
        throw new Error("unused");
      },
      resetEntity: async () => {
        throw new Error("unused");
      },
      testConnection: async () => {
        throw new Error("unused");
      },
      rotateApiKey: async () => {
        throw new Error("unused");
      },
      revokeApiKey: async () => {
        throw new Error("unused");
      }
    } satisfies GatewayConnectionBackend;
    const app = express();
    app.use("/admin", createAdminRouter(backend));

    const res = await request(app).get("/admin/api/state");

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "upstream failed" });
  });
});
