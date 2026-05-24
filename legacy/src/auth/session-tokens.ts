import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { JsonFileStore } from "../storage/json-file-store.js";

export interface StaticServiceToken {
  token: string;
  email: string;
  name?: string;
  profile?: string;
}

interface StoredSession {
  tokenHash: string;
  email: string;
  name?: string;
  clientId: string;
  scopes: string[];
  createdAt: string;
}

interface SessionState {
  sessions: StoredSession[];
}

export class SessionTokenStore {
  private readonly store: JsonFileStore<SessionState>;

  constructor(
    path: string,
    private readonly allowedDomains: string[],
    private readonly staticTokens: StaticServiceToken[]
  ) {
    this.store = new JsonFileStore(path, { sessions: [] });
  }

  async issue(email: string, clientId: string, scopes: string[], name?: string): Promise<OAuthTokens> {
    const normalizedEmail = normalizeEmail(email);
    this.assertAllowedEmail(normalizedEmail);
    const token = randomBytes(32).toString("base64url");
    const session: StoredSession = {
      tokenHash: hashToken(token),
      email: normalizedEmail,
      name,
      clientId,
      scopes,
      createdAt: new Date().toISOString()
    };
    await this.store.update((current) => ({ sessions: [...current.sessions, session] }));
    return {
      access_token: token,
      token_type: "Bearer",
      scope: scopes.join(" ")
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const staticAuth = this.verifyStaticToken(token);
    if (staticAuth) return staticAuth;

    const state = await this.store.read();
    const tokenHash = hashToken(token);
    const session = state.sessions.find((candidate) => candidate.tokenHash === tokenHash);
    if (!session) throw new Error("Invalid bearer token.");
    return {
      token,
      scopes: session.scopes,
      clientId: session.clientId,
      extra: {
        email: session.email,
        name: session.name,
        isStaticServiceToken: false
      }
    };
  }

  async listSessions(): Promise<Array<Pick<StoredSession, "email" | "clientId" | "scopes" | "createdAt">>> {
    const state = await this.store.read();
    return state.sessions.map(({ email, clientId, scopes, createdAt }) => ({ email, clientId, scopes, createdAt }));
  }

  private verifyStaticToken(token: string): AuthInfo | undefined {
    for (const entry of this.staticTokens) {
      if (!constantTimeEqual(token, entry.token)) continue;
      const email = normalizeEmail(entry.email);
      this.assertAllowedEmail(email);
      return {
        token,
        scopes: ["mcp:tools"],
        clientId: entry.profile ?? "static-service-token",
        extra: {
          email,
          name: entry.name,
          profile: entry.profile,
          isStaticServiceToken: true
        }
      };
    }
    return undefined;
  }

  private assertAllowedEmail(email: string): void {
    if (!this.allowedDomains.some((domain) => email.endsWith(`@${domain.toLowerCase()}`))) {
      throw new Error(`Email domain is not allowed: ${email}`);
    }
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  const maxLength = Math.max(left.length, right.length);
  const paddedLeft = Buffer.concat([left, Buffer.alloc(maxLength - left.length)]);
  const paddedRight = Buffer.concat([right, Buffer.alloc(maxLength - right.length)]);
  return timingSafeEqual(paddedLeft, paddedRight) && left.length === right.length;
}
