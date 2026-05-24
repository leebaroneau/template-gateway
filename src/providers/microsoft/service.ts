import { createHash } from "node:crypto";
import type { MicrosoftOAuthStateStore } from "./state-store.js";
import type { MicrosoftTokenStore } from "./token-store.js";
import type { MicrosoftActor, MicrosoftProviderConfig, MicrosoftStatus } from "./types.js";

// Fix 5: ISO 8601 datetime regex — exported so server.ts can reuse it instead
// of duplicating the literal.
export const ISO_8601_DATE_TIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

interface MicrosoftAuditEntry {
  provider: "microsoft";
  tool: string;
  actor: string;
  requiredScope: string;
  status: "ok" | "denied" | "reconnect_required" | "error";
  method?: string;
  path?: string;
  durationMs: number;
  upstreamRequestId?: string;
  error?: string;
  // sendEmail privacy fields
  subjectHash?: string;
  recipientCount?: number;
  attachmentCount?: number;
}

interface MicrosoftProviderServiceOptions {
  config: MicrosoftProviderConfig;
  stateStore: MicrosoftOAuthStateStore;
  tokenStore: MicrosoftTokenStore;
  fetch?: typeof fetch;
  audit?: (entry: MicrosoftAuditEntry) => void | Promise<void>;
}

interface ConnectUrlResult {
  provider: "microsoft";
  authorizeUrl: string;
  actor: MicrosoftActor;
  expiresAt: string;
}

interface CallbackInput {
  state: string;
  code: string;
}

interface CallbackResult {
  provider: "microsoft";
  status: "connected";
  actor: MicrosoftActor;
  upstreamLogin: string;
  tenantId: string;
  scopes: string[];
  expiresAt?: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface ValidAccessToken {
  accessToken: string;
  scopes: string[];
  upstreamLogin: string;
  tenantId: string;
}

interface MicrosoftProfileResponse {
  id?: string;
  mail?: string;
  userPrincipalName?: string;
  displayName?: string;
}

export class MicrosoftProviderService {
  private readonly fetchImpl: typeof fetch;
  // Fix 4: per-actor in-flight refresh deduplication. Prevents a concurrent
  // pair of expired-token calls from both initiating a refresh and the second
  // using the now-revoked refresh token (triggering invalid_grant + wipe of
  // the first call's freshly stored token).
  private readonly inflightRefreshes = new Map<string, Promise<{ accessToken: string; scopes: string[]; scope: string; expiresAt?: string }>>();

  constructor(private readonly options: MicrosoftProviderServiceOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async createConnectUrl(actor: MicrosoftActor): Promise<ConnectUrlResult> {
    this.assertConfigured();
    const normalizedActor = normalizeActor(actor);
    assertAllowedEmailDomain(normalizedActor.actorEmail, this.options.config.allowedDomains, "Microsoft actor email");
    const state = await this.options.stateStore.create(normalizedActor);
    return {
      provider: "microsoft",
      authorizeUrl: this.authorizationUrl(state.state),
      actor: normalizedActor,
      expiresAt: state.expiresAt
    };
  }

  async completeCallback(input: CallbackInput): Promise<CallbackResult> {
    this.assertConfigured();
    const state = await this.options.stateStore.consume(input.state);
    if (!state) {
      throw new Error("Unknown or expired Microsoft OAuth state.");
    }

    const token = await this.exchangeCode(input.code);
    if (!token.access_token) {
      throw new Error("Microsoft token response did not include an access token.");
    }

    const profile = await this.fetchProfile(token.access_token);
    const upstreamLogin = normalizeLogin(profile.mail || profile.userPrincipalName);
    if (!upstreamLogin) {
      throw new Error("Microsoft profile did not include mail or userPrincipalName.");
    }
    assertAllowedEmailDomain(upstreamLogin, this.options.config.allowedDomains, "Microsoft login");

    const scope = token.scope || this.options.config.scopes.join(" ");
    const expiresAt = token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000).toISOString()
      : undefined;
    const status = await this.options.tokenStore.saveConnectedBinding({
      actorId: state.actorId ?? state.actorEmail,
      actorEmail: state.actorEmail,
      actorName: state.actorName,
      upstreamLogin,
      tenantId: this.options.config.tenantId!,
      scope,
      expiresAt,
      payload: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        tokenType: token.token_type || "Bearer",
        scope,
        expiresAt,
        accountId: profile.id
      }
    });

    return {
      provider: "microsoft",
      status: "connected",
      actor: {
        actorId: status.actorId,
        actorEmail: status.actorEmail!,
        actorName: status.actorName
      },
      upstreamLogin: status.upstreamLogin!,
      tenantId: status.tenantId!,
      scopes: status.scopes,
      expiresAt: status.expiresAt
    };
  }

  async status(actorIdOrEmail: string): Promise<MicrosoftStatus> {
    return this.options.tokenStore.status(actorIdOrEmail);
  }

  listTools(): Array<{ name: string; requiredScope: string; readOnly: boolean }> {
    const base = [
      { name: "outlook_list_messages", requiredScope: "Mail.Read", readOnly: true },
      { name: "calendar_list_events", requiredScope: "Calendars.Read", readOnly: true },
      { name: "graph_request", requiredScope: "User.Read", readOnly: true }
    ];
    if (this.options.config.sendEmailEnabled) {
      base.push({ name: "outlook_send_email", requiredScope: "Mail.Send", readOnly: false });
    }
    return base;
  }

  async sendEmail(actorIdOrEmail: string, input: { to: string[]; subject: string; body: string; cc?: string[]; bcc?: string[] }): Promise<{ status: number }> {
    const subjectHash = createHash("sha256").update(input.subject ?? "").digest("hex").slice(0, 16);
    const recipientCount = (input.to?.length ?? 0) + (input.cc?.length ?? 0) + (input.bcc?.length ?? 0);
    const attachmentCount = 0; // v1: no attachments accepted
    return this.runTool(actorIdOrEmail, {
      tool: "outlook_send_email",
      requiredScope: "Mail.Send",
      method: "POST",
      path: "/me/sendMail",
      subjectHash,
      recipientCount,
      attachmentCount
    }, async () => {
      if (!this.options.config.sendEmailEnabled) {
        throw new Error("outlook_send_email is disabled (MICROSOFT_SEND_EMAIL_ENABLED=false).");
      }
      if (!input.to || input.to.length === 0) {
        throw new Error("outlook_send_email requires at least one recipient.");
      }
      const token = await this.requireValidAccessToken(actorIdOrEmail, "Mail.Send");
      const message = {
        message: {
          subject: input.subject,
          body: { contentType: "Text", content: input.body },
          toRecipients: input.to.map((address) => ({ emailAddress: { address } })),
          ccRecipients: (input.cc ?? []).map((address) => ({ emailAddress: { address } })),
          bccRecipients: (input.bcc ?? []).map((address) => ({ emailAddress: { address } })),
          internetMessageHeaders: [
            { name: "x-template-gateway", value: "microsoft" },
            { name: "x-template-gateway-actor", value: actorIdOrEmail }
          ]
        },
        saveToSentItems: true
      };
      const response = await this.fetchImpl("https://graph.microsoft.com/v1.0/me/sendMail", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(message)
      });
      if (!response.ok && response.status !== 202) {
        // Do NOT include the Graph response body in the error message — it
        // may echo back the user-supplied subject/body and would leak into
        // the audit record's `error` field, violating the sendEmail privacy
        // contract. Capture the upstream request id for correlation instead.
        const requestId = response.headers.get("request-id") ?? response.headers.get("client-request-id") ?? undefined;
        // Drain the body so the connection can be released.
        await response.text().catch(() => "");
        throw new Error(`Graph sendMail failed: ${response.status}${requestId ? ` (request-id ${requestId})` : ""}`);
      }
      return { status: response.status };
    });
  }

  async listMessages(
    actorIdOrEmail: string,
    options: { top?: number; query?: string; skip?: number }
  ): Promise<{ messages: unknown[]; nextLink?: string | null }> {
    return this.runTool(actorIdOrEmail, { tool: "outlook_list_messages", requiredScope: "Mail.Read", method: "GET", path: "/me/messages" }, async () => {
      const token = await this.requireValidAccessToken(actorIdOrEmail, "Mail.Read");
      const params: string[] = [];
      if (options.top !== undefined) params.push(`$top=${encodeURIComponent(String(options.top))}`);
      if (options.skip !== undefined) params.push(`$skip=${encodeURIComponent(String(options.skip))}`);
      if (options.query) params.push(`$search=${encodeURIComponent(`"${options.query}"`)}`);
      const queryString = params.length > 0 ? `?${params.join("&")}` : "";
      const requestUrl = `https://graph.microsoft.com/v1.0/me/messages${queryString}`;
      const response = await this.fetchImpl(requestUrl, {
        headers: { Authorization: `Bearer ${token.accessToken}` }
      });
      const payload = await response.json() as { value?: unknown[]; "@odata.nextLink"?: string };
      if (!response.ok) {
        throw new Error(`Graph listMessages failed: ${response.status} ${JSON.stringify(payload).slice(0, 200)}`);
      }
      if (!Array.isArray(payload.value)) {
        throw new Error(`Graph listMessages returned unexpected shape (value not array).`);
      }
      return {
        messages: payload.value,
        nextLink: payload["@odata.nextLink"] ?? null
      };
    });
  }

  async listEvents(
    actorIdOrEmail: string,
    options: { top?: number; skip?: number; timeMin?: string; timeMax?: string }
  ): Promise<{ events: unknown[]; nextLink?: string | null }> {
    return this.runTool(actorIdOrEmail, { tool: "calendar_list_events", requiredScope: "Calendars.Read", method: "GET", path: "/me/calendar/events" }, async () => {
      // Fix 5: validate timeMin/timeMax at the service layer before building
      // the OData filter — direct callers bypass the MCP Zod schema.
      if (options.timeMin !== undefined && !ISO_8601_DATE_TIME.test(options.timeMin)) {
        throw new Error(`calendar_list_events timeMin must be ISO 8601: ${options.timeMin}`);
      }
      if (options.timeMax !== undefined && !ISO_8601_DATE_TIME.test(options.timeMax)) {
        throw new Error(`calendar_list_events timeMax must be ISO 8601: ${options.timeMax}`);
      }
      const token = await this.requireValidAccessToken(actorIdOrEmail, "Calendars.Read");
      const params: string[] = [];
      if (options.top !== undefined) params.push(`$top=${encodeURIComponent(String(options.top))}`);
      if (options.skip !== undefined) params.push(`$skip=${encodeURIComponent(String(options.skip))}`);
      const filterParts: string[] = [];
      if (options.timeMin) filterParts.push(`start/dateTime ge '${options.timeMin}'`);
      if (options.timeMax) filterParts.push(`end/dateTime le '${options.timeMax}'`);
      if (filterParts.length > 0) params.push(`$filter=${encodeURIComponent(filterParts.join(" and "))}`);
      const queryString = params.length > 0 ? `?${params.join("&")}` : "";
      const requestUrl = `https://graph.microsoft.com/v1.0/me/calendar/events${queryString}`;
      const response = await this.fetchImpl(requestUrl, {
        headers: { Authorization: `Bearer ${token.accessToken}` }
      });
      const payload = await response.json() as { value?: unknown[]; "@odata.nextLink"?: string };
      if (!response.ok) {
        throw new Error(`Graph listEvents failed: ${response.status} ${JSON.stringify(payload).slice(0, 200)}`);
      }
      // Fix 9: reject malformed Graph responses that omit the value array.
      if (!Array.isArray(payload.value)) {
        throw new Error(`Graph listEvents returned unexpected shape (value not array).`);
      }
      return {
        events: payload.value,
        nextLink: payload["@odata.nextLink"] ?? null
      };
    });
  }

  async graphRequest(
    actorIdOrEmail: string,
    input: { method: "GET"; path: string }
  ): Promise<{ status: number; body: unknown }> {
    return this.runTool(actorIdOrEmail, { tool: "graph_request", requiredScope: "User.Read", method: input.method, path: input.path }, async () => {
      if (input.method !== "GET") {
        throw new Error(`graph_request method not allowed: ${input.method}. GET only.`);
      }
      this.assertAllowedGraphPath(input.path);
      const token = await this.requireValidAccessToken(actorIdOrEmail, "User.Read");
      const url = `https://graph.microsoft.com/v1.0${input.path}`;
      const response = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${token.accessToken}` }
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        // 401 means token rejected post-auth (rare since requireValidAccessToken
        // just refreshed). Surface as reconnect_required so the audit
        // classification catches it; the caller can re-auth.
        if (response.status === 401) {
          await this.options.tokenStore.markReconnectRequired(actorIdOrEmail);
          throw new Error(`graph_request returned 401; binding marked reconnect_required.`);
        }
        // 403 means the bound scope was insufficient for the resource
        // (Graph-side scope mismatch, not local). Surface as a denied-style error.
        if (response.status === 403) {
          throw new Error(`graph_request denied by Graph (403): required scope likely insufficient.`);
        }
        throw new Error(`graph_request failed: ${response.status}`);
      }
      return { status: response.status, body };
    });
  }

  private assertAllowedGraphPath(path: string): void {
    // Defend against percent-encoded traversal: decode once, then enforce
    // the same path rules against the decoded form (Graph normalizes %2E%2E
    // server-side before routing).
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      throw new Error(`graph_request path not allowed (invalid encoding): ${path}`);
    }
    if (
      !decoded.startsWith("/") ||
      decoded.includes("..") ||
      decoded.includes("\\") ||
      decoded.includes("?") ||
      decoded.includes("#") ||
      // Fix 1: reject double-encoded inputs (%252E%252E etc.). MCP-supplied
      // paths are always plain (/me/messages/<id>); a remaining % after one
      // decode round means the caller tried double-encoding to sneak past this
      // check. Reject rather than let Graph normalise server-side.
      decoded.includes("%")
    ) {
      throw new Error(`graph_request path not allowed (invalid path): ${path}`);
    }
    const allowed = this.options.config.graphRequestPathAllowlist;
    const ok = allowed.some((prefix) => decoded === prefix || decoded.startsWith(prefix + "/"));
    if (!ok) {
      throw new Error(`graph_request path not allowed: ${path}. Allowed prefixes: ${allowed.join(", ")}`);
    }
  }

  async requireValidAccessToken(actorIdOrEmail: string, requiredScope: string): Promise<ValidAccessToken> {
    const loaded = await this.options.tokenStore.loadBinding(actorIdOrEmail);
    if (!loaded) {
      throw new Error(`Microsoft provider not connected for actor: ${actorIdOrEmail}`);
    }
    const { binding, payload } = loaded;
    if (binding.status !== "connected") {
      throw new Error(`Microsoft binding is ${binding.status}; reconnect_required.`);
    }
    if (!binding.scopes.includes(requiredScope)) {
      throw new Error(`Required scope not bound: ${requiredScope}. Bound scopes: ${binding.scope}`);
    }
    if (this.tokenExpired(binding.expiresAt)) {
      const refreshed = await this.refreshAccessToken(actorIdOrEmail, payload.refreshToken);
      return { accessToken: refreshed.accessToken, scopes: refreshed.scopes, upstreamLogin: binding.upstreamLogin, tenantId: binding.tenantId };
    }
    return { accessToken: payload.accessToken, scopes: binding.scopes, upstreamLogin: binding.upstreamLogin, tenantId: binding.tenantId };
  }

  private tokenExpired(expiresAt: string | undefined): boolean {
    if (!expiresAt) return false;
    return new Date(expiresAt).getTime() <= Date.now() + 30_000;
  }

  private async refreshAccessToken(
    actorIdOrEmail: string,
    refreshToken: string | undefined
  ): Promise<{ accessToken: string; scopes: string[]; scope: string; expiresAt?: string }> {
    // Fix 4: deduplicate concurrent refresh calls for the same actor.
    // Two concurrent expired-token calls would both read the stale refresh
    // token; the second call uses the now-revoked token (invalid_grant) and
    // wipes the fresh token written by the first. Coalesce by actor key.
    const key = actorIdOrEmail.trim().toLowerCase();
    const existing = this.inflightRefreshes.get(key);
    if (existing) return existing;
    const promise = this.performRefresh(actorIdOrEmail, refreshToken);
    this.inflightRefreshes.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inflightRefreshes.delete(key);
    }
  }

  private async performRefresh(
    actorIdOrEmail: string,
    refreshToken: string | undefined
  ): Promise<{ accessToken: string; scopes: string[]; scope: string; expiresAt?: string }> {
    if (!refreshToken) {
      await this.options.tokenStore.markReconnectRequired(actorIdOrEmail);
      throw new Error("Microsoft refresh token absent; binding marked reconnect_required.");
    }
    const body = new URLSearchParams({
      client_id: this.options.config.clientId!,
      client_secret: this.options.config.clientSecret!,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      redirect_uri: this.options.config.redirectUri,
      scope: this.options.config.scopes.join(" ")
    });
    const response = await this.fetchImpl(`${tenantBaseUrl(this.options.config.tenantId!)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    const tokenPayload = await response.json() as TokenResponse;
    if (!response.ok) {
      if (tokenPayload.error === "invalid_grant") {
        await this.options.tokenStore.markReconnectRequired(actorIdOrEmail);
        throw new Error(`Microsoft refresh returned invalid_grant; binding marked reconnect_required: ${tokenPayload.error_description || ""}`);
      }
      throw new Error(tokenPayload.error_description || tokenPayload.error || "Microsoft token refresh failed.");
    }
    if (!tokenPayload.access_token) throw new Error("Microsoft refresh response did not include an access token.");
    const scope = tokenPayload.scope || this.options.config.scopes.join(" ");
    const expiresAt = tokenPayload.expires_in ? new Date(Date.now() + tokenPayload.expires_in * 1000).toISOString() : undefined;
    await this.options.tokenStore.updateTokenPayload(
      actorIdOrEmail,
      {
        accessToken: tokenPayload.access_token,
        refreshToken: tokenPayload.refresh_token ?? refreshToken,
        tokenType: tokenPayload.token_type || "Bearer",
        scope,
        expiresAt
      },
      scope,
      expiresAt
    );
    return { accessToken: tokenPayload.access_token, scopes: scope.split(" ").filter(Boolean), scope, expiresAt };
  }

  private authorizationUrl(state: string): string {
    const url = new URL(`${tenantBaseUrl(this.options.config.tenantId!)}/oauth2/v2.0/authorize`);
    url.searchParams.set("client_id", this.options.config.clientId!);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", this.options.config.redirectUri);
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("scope", this.options.config.scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("prompt", "select_account");
    return url.toString();
  }

  private async exchangeCode(code: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
      client_id: this.options.config.clientId!,
      client_secret: this.options.config.clientSecret!,
      grant_type: "authorization_code",
      code,
      redirect_uri: this.options.config.redirectUri,
      scope: this.options.config.scopes.join(" ")
    });
    const response = await this.fetchImpl(`${tenantBaseUrl(this.options.config.tenantId!)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    const payload = await response.json() as TokenResponse;
    if (!response.ok) {
      throw new Error(payload.error_description || payload.error || "Microsoft token exchange failed.");
    }
    return payload;
  }

  private async fetchProfile(accessToken: string): Promise<MicrosoftProfileResponse> {
    const response = await this.fetchImpl(
      "https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName,displayName",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const payload = await response.json() as MicrosoftProfileResponse & { error?: { message?: string } };
    if (!response.ok) {
      throw new Error(payload.error?.message || "Microsoft profile lookup failed.");
    }
    return payload;
  }

  private async runTool<T>(
    actorIdOrEmail: string,
    params: { tool: string; requiredScope: string; method?: string; path?: string; subjectHash?: string; recipientCount?: number; attachmentCount?: number },
    fn: () => Promise<T>
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      void this.emitAudit({ ...params, actor: actorIdOrEmail, status: "ok", durationMs: Date.now() - start })
        .catch((auditError) => {
          console.error("microsoft audit emit failed:", auditError);
        });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status: "denied" | "reconnect_required" | "error" =
        /required scope/i.test(message) ? "denied"
        : /reconnect_required/i.test(message) ? "reconnect_required"
        : "error";
      void this.emitAudit({ ...params, actor: actorIdOrEmail, status, durationMs: Date.now() - start, error: message })
        .catch((auditError) => {
          console.error("microsoft audit emit failed:", auditError);
        });
      throw error;
    }
  }

  private async emitAudit(entry: Omit<MicrosoftAuditEntry, "provider">): Promise<void> {
    if (!this.options.audit) return;
    await this.options.audit({ provider: "microsoft", ...entry });
  }

  private assertConfigured(): void {
    const missing = [
      ["MICROSOFT_CLIENT_ID", this.options.config.clientId],
      ["MICROSOFT_CLIENT_SECRET", this.options.config.clientSecret],
      ["MICROSOFT_TENANT_ID", this.options.config.tenantId],
      ["MICROSOFT_TOKEN_STORE_KEY", this.options.config.tokenStoreKey]
    ].filter(([, value]) => !value).map(([key]) => key);
    if (missing.length > 0) {
      throw new Error(`Microsoft provider is not configured. Missing: ${missing.join(", ")}`);
    }
  }
}

function tenantBaseUrl(tenantId: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}`;
}

function normalizeActor(actor: MicrosoftActor): MicrosoftActor {
  return {
    actorId: actor.actorId?.trim() || actor.actorEmail.trim().toLowerCase(),
    actorEmail: actor.actorEmail.trim().toLowerCase(),
    actorName: actor.actorName?.trim() || undefined
  };
}

function normalizeLogin(login: string | undefined): string | undefined {
  const normalized = login?.trim().toLowerCase();
  return normalized || undefined;
}

function assertAllowedEmailDomain(email: string, domains: string[], label: string): void {
  const normalized = email.trim().toLowerCase();
  const allowed = domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean);
  if (!allowed.some((domain) => normalized.endsWith(`@${domain}`))) {
    throw new Error(`${label} domain is not allowed: ${normalized}`);
  }
}
