import { describe, expect, it } from "vitest";
import {
  normalizeRegionCode,
  normalizeSlug,
  optionalText,
  sanitizeConnectionConfig,
  sanitizePartialConfigSummary
} from "../src/admin/input-validation.js";
import type { Connector } from "../src/admin/types.js";

const shopifyConnector: Connector = {
  id: "connector_shopify",
  slug: "shopify",
  name: "Shopify",
  category: "commerce",
  authMode: "oauth",
  backendOptions: ["nango", "native"],
  requiredFields: [
    { key: "shop_domain", label: "Shop domain" },
    { key: "access_token", label: "Access token", secret: true }
  ],
  scopes: ["orders:read"],
  description: "Shopify test connector."
};

describe("admin input validation", () => {
  it("normalizes slugs and region codes", () => {
    expect(normalizeSlug("Koenig Machinery", "Brand name")).toBe("koenig-machinery");
    expect(normalizeRegionCode(" au ")).toBe("AU");
  });

  it("rejects null optional text values", () => {
    expect(() => optionalText(null, "Region domain")).toThrow(/Region domain must be a string/);
  });

  it("sanitizes required connector config without echoing raw secrets", () => {
    const sanitized = sanitizeConnectionConfig(shopifyConnector, {
      shop_domain: "koenig.myshopify.com",
      access_token: "shpat_raw_secret",
      access_token_ref: "vault://shopify/koenig"
    });

    expect(sanitized).toEqual({
      shop_domain: "koenig.myshopify.com",
      access_token_ref: "fixture-redacted:access_token"
    });
    expect(JSON.stringify(sanitized)).not.toContain("shpat_raw_secret");
    expect(JSON.stringify(sanitized)).not.toContain("vault://shopify/koenig");
  });

  it("rejects unsafe partial config summary keys", () => {
    expect(() =>
      sanitizePartialConfigSummary({
        property_id: "properties/123",
        refresh_token: "raw-refresh-token"
      })
    ).toThrow(/Unsafe config field: refresh_token/);

    expect(() =>
      sanitizePartialConfigSummary({
        api_key: "raw-api-key"
      })
    ).toThrow(/Unsafe config field: api_key/);

    expect(() =>
      sanitizePartialConfigSummary({
        secret: "raw-secret"
      })
    ).toThrow(/Unsafe config field: secret/);
  });

  it("keeps safe partial config summary keys as trimmed strings", () => {
    expect(
      sanitizePartialConfigSummary({
        property_id: " properties/123 ",
        account_ref: " gateway:google/default ",
        empty: " "
      })
    ).toEqual({
      property_id: "properties/123",
      account_ref: "gateway:google/default"
    });
  });
});
