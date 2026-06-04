// src/shopify-oauth/hmac.ts
import crypto from "node:crypto";

/**
 * Normalize a Shopify shop domain. Accepts bare hostname or https:// URL.
 * Returns null if invalid (not *.myshopify.com, anchored regex both ends).
 */
export function normalizeShopDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  const withoutProtocol = trimmed.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!withoutProtocol) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(withoutProtocol)) return null;
  return withoutProtocol;
}

/**
 * Verify the Shopify callback query-param HMAC.
 * Algorithm: remove 'hmac' (and 'signature') from params, sort remaining keys
 * alphabetically, join as 'key=value&key=value', HMAC-SHA256 HEX with apiSecret,
 * timing-safe compare to query.hmac.
 */
export function verifyCallbackHmac(
  query: Record<string, string | string[]>,
  apiSecret: string
): boolean {
  const providedHmac = query.hmac;
  if (!providedHmac || typeof providedHmac !== "string") return false;

  const params = Object.entries(query)
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value[0] : value}`)
    .join("&");

  const digest = crypto.createHmac("sha256", apiSecret).update(params).digest("hex");

  // Length guard before timingSafeEqual (throws on unequal lengths)
  if (digest.length !== providedHmac.length) return false;
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(providedHmac));
}

/**
 * Verify a Shopify webhook HMAC.
 * Algorithm: HMAC-SHA256 over rawBody bytes → base64, compare to X-Shopify-Hmac-Sha256 header.
 * rawBody MUST be the raw Buffer (not parsed JSON).
 */
export function verifyWebhookHmac(
  rawBody: Buffer,
  hmacHeader: string | undefined,
  apiSecret: string
): boolean {
  if (!hmacHeader) return false;
  const digest = crypto.createHmac("sha256", apiSecret).update(rawBody).digest("base64");
  if (digest.length !== hmacHeader.length) return false;
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
}
