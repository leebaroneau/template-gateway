import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { JsonFileStore } from "../../storage/json-file-store.js";
import type { MicrosoftActor, MicrosoftBinding, MicrosoftStatus, MicrosoftTokenPayload } from "./types.js";

interface MicrosoftTokenData {
  bindings: MicrosoftBinding[];
}

interface SaveBindingInput extends MicrosoftActor {
  upstreamLogin: string;
  tenantId: string;
  scope: string;
  expiresAt?: string;
  payload: MicrosoftTokenPayload;
}

export class MicrosoftTokenStore {
  private readonly store: JsonFileStore<MicrosoftTokenData>;

  constructor(
    path: string,
    private readonly keyBase64?: string
  ) {
    this.store = new JsonFileStore(path, { bindings: [] });
  }

  async saveConnectedBinding(input: SaveBindingInput): Promise<MicrosoftStatus> {
    const actorId = actorKey(input.actorId ?? input.actorEmail);
    const now = new Date().toISOString();
    const tokenCiphertext = encryptTokenPayload(input.payload, this.keyBase64);
    const existing = (await this.store.read()).bindings.find((binding) => binding.actorId === actorId);
    const binding: MicrosoftBinding = {
      actorId,
      actorEmail: input.actorEmail.trim().toLowerCase(),
      actorName: input.actorName,
      provider: "microsoft",
      upstreamLogin: input.upstreamLogin.trim().toLowerCase(),
      tenantId: input.tenantId,
      scope: input.scope,
      scopes: splitScopes(input.scope),
      expiresAt: input.expiresAt,
      tokenCiphertext,
      status: "connected",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    await this.store.update((current) => ({
      bindings: [
        ...current.bindings.filter((candidate) => candidate.actorId !== actorId),
        binding
      ].sort((a, b) => a.actorId.localeCompare(b.actorId))
    }));

    return statusFromBinding(binding);
  }

  async status(actorIdOrEmail: string): Promise<MicrosoftStatus> {
    const binding = await this.getBinding(actorIdOrEmail);
    if (!binding) {
      return {
        provider: "microsoft",
        status: "disconnected",
        actorId: actorKey(actorIdOrEmail),
        scopes: []
      };
    }
    return statusFromBinding(binding);
  }

  async getBinding(actorIdOrEmail: string): Promise<MicrosoftBinding | undefined> {
    const state = await this.store.read();
    const key = actorKey(actorIdOrEmail);
    const email = actorIdOrEmail.trim().toLowerCase();
    return state.bindings.find((binding) => binding.actorId === key || binding.actorEmail === email);
  }

  async readTokenPayload(actorIdOrEmail: string): Promise<MicrosoftTokenPayload | undefined> {
    const binding = await this.getBinding(actorIdOrEmail);
    return binding ? decryptTokenPayload(binding.tokenCiphertext, this.keyBase64) : undefined;
  }

  async loadBinding(actorIdOrEmail: string): Promise<{ binding: MicrosoftBinding; payload: MicrosoftTokenPayload } | undefined> {
    const binding = await this.getBinding(actorIdOrEmail);
    if (!binding) return undefined;
    const payload = decryptTokenPayload(binding.tokenCiphertext, this.keyBase64);
    return { binding, payload };
  }

  async updateTokenPayload(
    actorIdOrEmail: string,
    payload: MicrosoftTokenPayload,
    scope: string,
    expiresAt?: string
  ): Promise<void> {
    const tokenCiphertext = encryptTokenPayload(payload, this.keyBase64);
    const key = actorKey(actorIdOrEmail);
    const email = actorIdOrEmail.trim().toLowerCase();
    const now = new Date().toISOString();
    await this.store.update((current) => ({
      bindings: current.bindings.map((binding) => {
        if (binding.actorId !== key && binding.actorEmail !== email) return binding;
        return {
          ...binding,
          tokenCiphertext,
          scope,
          scopes: splitScopes(scope),
          expiresAt,
          status: "connected" as const,
          updatedAt: now
        };
      })
    }));
  }

  async markReconnectRequired(actorIdOrEmail: string): Promise<void> {
    const key = actorKey(actorIdOrEmail);
    const email = actorIdOrEmail.trim().toLowerCase();
    const now = new Date().toISOString();
    await this.store.update((current) => ({
      bindings: current.bindings.map((binding) => {
        if (binding.actorId !== key && binding.actorEmail !== email) return binding;
        return { ...binding, status: "reconnect_required" as const, updatedAt: now };
      })
    }));
  }
}

function statusFromBinding(binding: MicrosoftBinding): MicrosoftStatus {
  return {
    provider: "microsoft",
    status: binding.status,
    actorId: binding.actorId,
    actorEmail: binding.actorEmail,
    actorName: binding.actorName,
    upstreamLogin: binding.upstreamLogin,
    tenantId: binding.tenantId,
    scopes: binding.scopes,
    expiresAt: binding.expiresAt
  };
}

function encryptTokenPayload(payload: MicrosoftTokenPayload, keyBase64?: string): string {
  const key = decodeKey(keyBase64);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url")
  ].join(".");
}

function decryptTokenPayload(ciphertext: string, keyBase64?: string): MicrosoftTokenPayload {
  const key = decodeKey(keyBase64);
  const [version, ivBase64, tagBase64, ciphertextBase64] = ciphertext.split(".");
  if (version !== "v1" || !ivBase64 || !tagBase64 || !ciphertextBase64) {
    throw new Error("Unsupported Microsoft token ciphertext format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivBase64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagBase64, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, "base64url")),
    decipher.final()
  ]);
  return JSON.parse(plaintext.toString("utf8")) as MicrosoftTokenPayload;
}

function decodeKey(keyBase64?: string): Buffer {
  if (!keyBase64) {
    throw new Error("Microsoft token store key is not configured.");
  }
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("Microsoft token store key must decode to 32 bytes.");
  }
  return key;
}

function actorKey(value: string): string {
  return value.trim().toLowerCase();
}

function splitScopes(scope: string): string[] {
  return scope.split(/\s+/).map((part) => part.trim()).filter(Boolean);
}
