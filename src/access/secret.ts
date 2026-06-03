import crypto from "node:crypto";

const SECRET_PREFIX = "gw_live_";
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_SALT_LENGTH = 16;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

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

function decodeCanonicalBase64Url(value: string): Buffer | undefined {
  if (!BASE64URL_PATTERN.test(value)) {
    return undefined;
  }

  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === 0 || decoded.toString("base64url") !== value) {
    return undefined;
  }

  return decoded;
}

export function verifyApiKeySecret(secret: string, storedHash: string): boolean {
  const parts = storedHash.split("$");
  if (parts.length !== 6) {
    return false;
  }

  const [algorithm, nValue, rValue, pValue, salt, expectedValue] = parts;
  if (
    algorithm !== "scrypt" ||
    nValue !== String(SCRYPT_PARAMS.N) ||
    rValue !== String(SCRYPT_PARAMS.r) ||
    pValue !== String(SCRYPT_PARAMS.p)
  ) {
    return false;
  }

  try {
    const decodedSalt = decodeCanonicalBase64Url(salt);
    const expected = decodeCanonicalBase64Url(expectedValue);
    if (decodedSalt?.length !== SCRYPT_SALT_LENGTH || expected?.length !== SCRYPT_KEY_LENGTH) {
      return false;
    }

    const actual = crypto.scryptSync(secret, salt, SCRYPT_KEY_LENGTH, SCRYPT_PARAMS);
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
