// test/shopify-oauth-hmac.test.ts
import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  normalizeShopDomain,
  verifyCallbackHmac,
  verifyWebhookHmac,
} from "../src/shopify-oauth/hmac.js";

// ---------------------------------------------------------------------------
// Helpers — compute expected values with the same algorithm so tests remain
// correct even if Shopify ever changes encoding. No magic hardcoded strings.
// ---------------------------------------------------------------------------

function computeCallbackHmac(
  query: Record<string, string | string[]>,
  secret: string
): string {
  const params = Object.entries(query)
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value[0] : value}`)
    .join("&");
  return crypto.createHmac("sha256", secret).update(params).digest("hex");
}

function computeWebhookHmac(body: Buffer, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("base64");
}

// ---------------------------------------------------------------------------
// normalizeShopDomain
// ---------------------------------------------------------------------------

describe("normalizeShopDomain", () => {
  it("returns bare hostname unchanged", () => {
    expect(normalizeShopDomain("good.myshopify.com")).toBe("good.myshopify.com");
  });

  it("lowercases the domain", () => {
    expect(normalizeShopDomain("GOOD.myshopify.com")).toBe("good.myshopify.com");
  });

  it("strips https:// prefix and trailing slash", () => {
    expect(normalizeShopDomain("https://good.myshopify.com/")).toBe("good.myshopify.com");
  });

  it("strips path after domain", () => {
    expect(normalizeShopDomain("good.myshopify.com/path/hack")).toBe("good.myshopify.com");
  });

  it("returns null for non-myshopify domain", () => {
    expect(normalizeShopDomain("evil.com")).toBeNull();
  });

  it("returns null for trailing component trick (x.myshopify.com.evil.com)", () => {
    expect(normalizeShopDomain("x.myshopify.com.evil.com")).toBeNull();
  });

  it("returns null for bare myshopify.com (no subdomain)", () => {
    expect(normalizeShopDomain("myshopify.com")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizeShopDomain("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// verifyCallbackHmac
// ---------------------------------------------------------------------------

describe("verifyCallbackHmac", () => {
  const secret = "test-api-secret-abc123";

  const baseQuery: Record<string, string> = {
    code: "0907a61c0c8d55e99db179b68161bc00",
    shop: "some-shop.myshopify.com",
    state: "0.6784241404160823",
    timestamp: "1337178173",
  };

  it("returns true for a valid HMAC", () => {
    const hmac = computeCallbackHmac(baseQuery, secret);
    const query = { ...baseQuery, hmac };
    expect(verifyCallbackHmac(query, secret)).toBe(true);
  });

  it("returns false when a param value is tampered", () => {
    const hmac = computeCallbackHmac(baseQuery, secret);
    const query = { ...baseQuery, hmac, code: "tampered_code" };
    expect(verifyCallbackHmac(query, secret)).toBe(false);
  });

  it("returns false with wrong apiSecret", () => {
    const hmac = computeCallbackHmac(baseQuery, secret);
    const query = { ...baseQuery, hmac };
    expect(verifyCallbackHmac(query, "wrong-secret")).toBe(false);
  });

  it("returns false when hmac key is missing", () => {
    const query: Record<string, string> = { ...baseQuery };
    expect(verifyCallbackHmac(query, secret)).toBe(false);
  });

  it("includes extra non-hmac params in the digest (they must not be dropped)", () => {
    const queryWithExtra = { ...baseQuery, extra_param: "extra_value" };
    // Correct HMAC computed WITH extra_param — should verify
    const hmacWithExtra = computeCallbackHmac(queryWithExtra, secret);
    expect(
      verifyCallbackHmac({ ...queryWithExtra, hmac: hmacWithExtra }, secret)
    ).toBe(true);

    // HMAC computed WITHOUT extra_param — should fail (proves extra param is included)
    const hmacWithoutExtra = computeCallbackHmac(baseQuery, secret);
    expect(
      verifyCallbackHmac({ ...queryWithExtra, hmac: hmacWithoutExtra }, secret)
    ).toBe(false);
  });

  it("excludes 'signature' from the digest (Shopify legacy compat)", () => {
    // HMAC computed without 'signature' key present should still verify even
    // when 'signature' is present in the query object.
    const hmac = computeCallbackHmac(baseQuery, secret);
    const queryWithSig = { ...baseQuery, hmac, signature: "some-legacy-sig" };
    expect(verifyCallbackHmac(queryWithSig, secret)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// verifyWebhookHmac
// ---------------------------------------------------------------------------

describe("verifyWebhookHmac", () => {
  const secret = "webhook-secret-xyz987";
  const bodyStr = JSON.stringify({ id: 1, topic: "orders/create" });
  const rawBody = Buffer.from(bodyStr, "utf-8");

  it("returns true for a valid webhook HMAC", () => {
    const hmacHeader = computeWebhookHmac(rawBody, secret);
    expect(verifyWebhookHmac(rawBody, hmacHeader, secret)).toBe(true);
  });

  it("returns false when the body has been altered", () => {
    const hmacHeader = computeWebhookHmac(rawBody, secret);
    const alteredBody = Buffer.from(JSON.stringify({ id: 2, topic: "orders/create" }));
    expect(verifyWebhookHmac(alteredBody, hmacHeader, secret)).toBe(false);
  });

  it("returns false with wrong apiSecret", () => {
    const hmacHeader = computeWebhookHmac(rawBody, secret);
    expect(verifyWebhookHmac(rawBody, hmacHeader, "wrong-secret")).toBe(false);
  });

  it("returns false when hmacHeader is undefined", () => {
    expect(verifyWebhookHmac(rawBody, undefined, secret)).toBe(false);
  });

  it("returns false when hmacHeader is an empty string", () => {
    expect(verifyWebhookHmac(rawBody, "", secret)).toBe(false);
  });
});
