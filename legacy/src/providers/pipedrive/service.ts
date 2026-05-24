import type { PipedriveOAuthStateStore } from "./state-store.js";
import type { PipedriveTokenStore } from "./token-store.js";
import type { PipedriveActor, PipedriveProviderConfig, PipedriveStatus } from "./types.js";

interface PipedriveProviderServiceOptions {
  config: PipedriveProviderConfig;
  stateStore: PipedriveOAuthStateStore;
  tokenStore: PipedriveTokenStore;
  fetch?: typeof fetch;
}

interface ConnectUrlResult {
  provider: "pipedrive";
  authorizeUrl: string;
  actor: PipedriveActor;
  expiresAt: string;
}

interface CallbackInput {
  state: string;
  code: string;
}

interface CallbackResult {
  provider: "pipedrive";
  status: "connected";
  actor: PipedriveActor;
  upstreamLogin: string;
  upstreamName?: string;
  apiDomain?: string;
  scopes: string[];
  expiresAt?: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  /**
   * Pipedrive returns the workspace's API base URL (e.g. `https://acme.pipedrive.com`).
   * This is the authoritative host to call for that user — always prefer it over the
   * configured `companyDomain` fallback when present.
   */
  api_domain?: string;
  error?: string;
  error_description?: string;
}

interface PipedriveUsersMeResponse {
  data?: {
    email?: string;
    name?: string;
  };
  error?: string;
  error_info?: string;
}

export class PipedriveProviderService {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: PipedriveProviderServiceOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async createConnectUrl(actor: PipedriveActor): Promise<ConnectUrlResult> {
    this.assertConfigured();
    const normalizedActor = normalizeActor(actor);
    assertAllowedEmailDomain(normalizedActor.actorEmail, this.options.config.allowedDomains, "Pipedrive actor email");
    const state = await this.options.stateStore.create(normalizedActor);
    return {
      provider: "pipedrive",
      authorizeUrl: this.authorizationUrl(state.state),
      actor: normalizedActor,
      expiresAt: state.expiresAt
    };
  }

  async completeCallback(input: CallbackInput): Promise<CallbackResult> {
    this.assertConfigured();
    const state = await this.options.stateStore.consume(input.state);
    if (!state) {
      throw new Error("Unknown or expired Pipedrive OAuth state.");
    }

    const tokens = await this.exchangeCode(input.code);
    if (!tokens.access_token) {
      throw new Error("Pipedrive token response did not include an access token.");
    }

    const upstream = await this.fetchAuthenticatedUser({
      apiDomain: tokens.api_domain,
      accessToken: tokens.access_token
    });
    if (!upstream?.email) {
      // The provider deliberately does NOT swallow this — the caller (HTTP layer)
      // surfaces it to the operator so OAuth flows fail loudly instead of binding
      // half-resolved identities.
      throw new Error("Could not determine the authorizing Pipedrive user's email.");
    }
    assertAllowedEmailDomain(upstream.email, this.options.config.allowedDomains, "Pipedrive login");

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : undefined;
    const apiDomain = normalizeApiDomain(tokens.api_domain);
    const scope = tokens.scope ?? (this.options.config.scopes.length ? this.options.config.scopes.join(" ") : undefined);

    const status = await this.options.tokenStore.saveConnectedBinding({
      actorId: state.actorId ?? state.actorEmail,
      actorEmail: state.actorEmail,
      actorName: state.actorName,
      upstreamLogin: upstream.email,
      upstreamName: upstream.name,
      apiDomain,
      scope,
      expiresAt,
      payload: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenType: tokens.token_type || "Bearer",
        scope,
        apiDomain,
        expiresAt
      }
    });

    return {
      provider: "pipedrive",
      status: "connected",
      actor: {
        actorId: status.actorId,
        actorEmail: status.actorEmail!,
        actorName: status.actorName
      },
      upstreamLogin: status.upstreamLogin!,
      upstreamName: status.upstreamName,
      apiDomain: status.apiDomain,
      scopes: status.scopes,
      expiresAt: status.expiresAt
    };
  }

  async status(actorIdOrEmail: string): Promise<PipedriveStatus> {
    return this.options.tokenStore.status(actorIdOrEmail);
  }

  listTools(): Array<{ name: string; requiredScope: string; readOnly: boolean }> {
    return [
      { name: "pipedrive_search_deals", requiredScope: "deals:read", readOnly: true },
      { name: "pipedrive_search_persons", requiredScope: "contacts:read", readOnly: true },
      { name: "pipedrive_create_deal", requiredScope: "deals:full", readOnly: false }
    ];
  }

  private authorizationUrl(state: string): string {
    const url = new URL(this.options.config.authorizeUrl);
    url.searchParams.set("client_id", this.options.config.clientId!);
    url.searchParams.set("redirect_uri", this.options.config.redirectUri);
    url.searchParams.set("state", state);
    if (this.options.config.scopes.length > 0) {
      url.searchParams.set("scope", this.options.config.scopes.join(" "));
    }
    return url.toString();
  }

  private async exchangeCode(code: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.options.config.redirectUri
    });
    const credentials = Buffer.from(
      `${this.options.config.clientId}:${this.options.config.clientSecret}`
    ).toString("base64");
    const response = await this.fetchImpl(this.options.config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`
      },
      body
    });
    const payload = (await response.json()) as TokenResponse;
    if (!response.ok || !payload.access_token) {
      throw new Error(payload.error_description || payload.error || "Pipedrive token exchange failed.");
    }
    return payload;
  }

  /**
   * Resolve the authorizing user's identity via Pipedrive's `users/me` endpoint.
   *
   * Pipedrive workspaces live on per-tenant subdomains and the OAuth token
   * response includes `api_domain` for the workspace the user authorized on.
   * That field is authoritative — `companyDomain` from config is only a
   * fallback for cases where `api_domain` is absent (which shouldn't happen
   * in practice but guards old token responses and tests). Logging the actual
   * HTTP status on non-OK responses keeps the failure mode diagnosable.
   */
  private async fetchAuthenticatedUser(input: {
    apiDomain?: string;
    accessToken: string;
  }): Promise<{ email?: string; name?: string } | undefined> {
    const baseUrl = pipedriveBaseUrl(input.apiDomain, this.options.config.companyDomain);
    if (!baseUrl) {
      console.warn("[pipedrive] fetchAuthenticatedUser: no api_domain or companyDomain available");
      return undefined;
    }
    const url = `${baseUrl}/v1/users/me`;
    try {
      const response = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${input.accessToken}` }
      });
      if (!response.ok) {
        const excerpt = (await response.text().catch(() => "")).slice(0, 200);
        console.warn(
          `[pipedrive] fetchAuthenticatedUser: GET ${url} -> ${response.status} ${response.statusText} body=${JSON.stringify(excerpt)}`
        );
        return undefined;
      }
      const payload = (await response.json()) as PipedriveUsersMeResponse;
      const email = payload.data?.email;
      const name = payload.data?.name;
      return {
        email: typeof email === "string" ? email.trim().toLowerCase() : undefined,
        name: typeof name === "string" && name.trim() ? name.trim() : undefined
      };
    } catch (err) {
      console.warn(
        `[pipedrive] fetchAuthenticatedUser: GET ${url} threw ${(err as Error)?.message ?? err}`
      );
      return undefined;
    }
  }

  private assertConfigured(): void {
    const missing = [
      ["PIPEDRIVE_CLIENT_ID", this.options.config.clientId],
      ["PIPEDRIVE_CLIENT_SECRET", this.options.config.clientSecret],
      ["PIPEDRIVE_TOKEN_STORE_KEY", this.options.config.tokenStoreKey]
    ].filter(([, value]) => !value).map(([key]) => key);
    if (missing.length > 0) {
      throw new Error(`Pipedrive provider is not configured. Missing: ${missing.join(", ")}`);
    }
  }
}

/**
 * Pick the right base URL for `v1/users/me` and downstream API calls.
 *
 * - When the token response includes `api_domain`, use it verbatim (it is the
 *   authoritative workspace base URL for the authorized user).
 * - Otherwise, fall back to `https://{companyDomain}.pipedrive.com`.
 * - If neither is available, return undefined so callers can fail loudly.
 *
 * Pipedrive's `api_domain` is always a full URL today, but this helper also
 * tolerates a bare host (e.g. `acme.pipedrive.com`) for robustness.
 */
export function pipedriveBaseUrl(
  apiDomain: string | undefined,
  companyDomain: string | undefined
): string | undefined {
  if (apiDomain && apiDomain.trim()) {
    const trimmed = apiDomain.trim().replace(/\/+$/, "");
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }
  if (companyDomain && companyDomain.trim()) {
    return `https://${companyDomain.trim()}.pipedrive.com`;
  }
  return undefined;
}

function normalizeApiDomain(apiDomain: string | undefined): string | undefined {
  if (!apiDomain) return undefined;
  const trimmed = apiDomain.trim().replace(/\/+$/, "");
  if (!trimmed) return undefined;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function normalizeActor(actor: PipedriveActor): PipedriveActor {
  return {
    actorId: actor.actorId?.trim() || actor.actorEmail.trim().toLowerCase(),
    actorEmail: actor.actorEmail.trim().toLowerCase(),
    actorName: actor.actorName?.trim() || undefined
  };
}

function assertAllowedEmailDomain(email: string, domains: string[], label: string): void {
  const normalized = email.trim().toLowerCase();
  const allowed = domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean);
  if (!allowed.some((domain) => normalized.endsWith(`@${domain}`))) {
    throw new Error(`${label} domain is not allowed: ${normalized}`);
  }
}
