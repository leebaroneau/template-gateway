import type { OAuthAccountTokenPayload } from "./types.js";
import {
  decryptCredential as sharedDecryptCredential,
  encryptCredential as sharedEncryptCredential
} from "../shared/token-crypto.js";

export const encryptCredential = (payload: OAuthAccountTokenPayload, base64urlKey: string): string =>
  sharedEncryptCredential(payload, base64urlKey);

export const decryptCredential = (encrypted: string, base64urlKey: string): OAuthAccountTokenPayload =>
  sharedDecryptCredential<OAuthAccountTokenPayload>(encrypted, base64urlKey);
