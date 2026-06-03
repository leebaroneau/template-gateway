import crypto from "node:crypto";

const SECRET_PREFIX = "gw_live_";
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

export function createApiKeySecret(): string {
  return `${SECRET_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
}

export function previewApiKeySecret(secret: string): string {
  return `${SECRET_PREFIX}...${secret.slice(-4)}`;
}

export function fingerprintApiKeySecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex").slice(0, 16);
}

export function hashApiKeySecret(secret: string): string {
  const salt = crypto.randomBytes(16).toString("base64url");
  const derived = crypto.scryptSync(secret, salt, SCRYPT_KEY_LENGTH, SCRYPT_PARAMS).toString("base64url");
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt}$${derived}`;
}

export function verifyApiKeySecret(secret: string, storedHash: string): boolean {
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }

  const [, nValue, rValue, pValue, salt, expectedValue] = parts;
  const N = Number(nValue);
  const r = Number(rValue);
  const p = Number(pValue);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  try {
    const expected = Buffer.from(expectedValue, "base64url");
    if (expected.length === 0) {
      return false;
    }
    const actual = crypto.scryptSync(secret, salt, expected.length, { N, r, p });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
