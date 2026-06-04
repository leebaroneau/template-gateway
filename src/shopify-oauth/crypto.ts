import type { ShopifyTokenPayload } from "./types.js";
import {
  decryptCredential as sharedDecryptCredential,
  encryptCredential as sharedEncryptCredential,
} from "../shared/token-crypto.js";

export const encryptCredential = (payload: ShopifyTokenPayload, base64urlKey: string): string =>
  sharedEncryptCredential(payload, base64urlKey);

export const decryptCredential = (encrypted: string, base64urlKey: string): ShopifyTokenPayload =>
  sharedDecryptCredential<ShopifyTokenPayload>(encrypted, base64urlKey);
