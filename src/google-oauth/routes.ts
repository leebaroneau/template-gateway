import express from "express";
import type { GoogleOAuthConfig } from "./adapter.js";
import type { GoogleOAuthAdapter } from "./adapter.js";
import type { GatewayGoogleStore } from "./store.js";
import type { GatewayAccountStore } from "../account-credentials/store.js";
import type { GatewayAccessStore } from "../access/store.js";
import type { GoogleAccountLinker } from "./linker.js";
import { googleProducts } from "./types.js";
import type { GoogleLinkRequest, GoogleOAuthCredential } from "./types.js";

export interface CreateGoogleOAuthRouterOptions {
  config: GoogleOAuthConfig | undefined;
  adapter: GoogleOAuthAdapter | undefined;
  store: GatewayGoogleStore | undefined;
  bearer: string;
  accessStore?: GatewayAccessStore;
  accountStore?: GatewayAccountStore;
  linker?: GoogleAccountLinker;
}

function stripEncryptedPayload(
  cred: GoogleOAuthCredential & { encryptedPayload: string }
): GoogleOAuthCredential {
  const { encryptedPayload: _omit, ...rest } = cred;
  return rest as GoogleOAuthCredential;
}

export function createGoogleOAuthRouter(
  options: CreateGoogleOAuthRouterOptions
): express.Router {
  const router = express.Router();
  router.use(express.json());

  const { config, adapter, store, bearer, accountStore, linker } = options;

  // If not configured, all routes return 501
  if (!config || !adapter || !store) {
    router.use((_req, res) => {
      res.status(501).json({
        error: "not_configured",
        message: "Google OAuth is not configured on this gateway instance."
      });
    });
    return router;
  }

  // Bearer auth middleware
  function requireBearer(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ): void {
    if (req.get("Authorization") !== `Bearer ${bearer}`) {
      res.status(401).json({ error: "unauthorized", message: "Bearer token required." });
      return;
    }
    next();
  }

  // GET /credentials — list all credentials without encryptedPayload
  router.get("/credentials", requireBearer, (_req, res) => {
    const credentials = store.listCredentials().map(stripEncryptedPayload);
    res.json({ credentials });
  });

  // GET /credentials/:id — get single credential with its bindings
  router.get("/credentials/:id", requireBearer, (req, res) => {
    const raw = store.getCredential(req.params.id);
    if (!raw) {
      res.status(404).json({ error: "not_found", message: "Credential not found." });
      return;
    }
    const credential = stripEncryptedPayload(raw);
    const bindings = store.listBindingsForCredential(req.params.id);
    res.json({ credential, bindings });
  });

  // POST /start — begin OAuth flow
  router.post("/start", (req, res) => {
    const { brandId, regionId, products, bindings } = req.body as {
      brandId?: unknown;
      regionId?: unknown;
      products?: unknown;
      bindings?: unknown;
    };

    if (!brandId || typeof brandId !== "string") {
      res.status(400).json({ error: "invalid_input", message: "brandId is required." });
      return;
    }
    if (!regionId || typeof regionId !== "string") {
      res.status(400).json({ error: "invalid_input", message: "regionId is required." });
      return;
    }
    if (!Array.isArray(products) || products.length === 0) {
      res.status(400).json({ error: "invalid_input", message: "products must be a non-empty array." });
      return;
    }
    for (const p of products) {
      if (!googleProducts.includes(p as never)) {
        res.status(400).json({
          error: "invalid_input",
          message: `Unknown product: "${String(p)}". Valid products: ${googleProducts.join(", ")}.`
        });
        return;
      }
    }
    if (!Array.isArray(bindings)) {
      res.status(400).json({ error: "invalid_input", message: "bindings must be an array." });
      return;
    }

    const result = adapter.startFlow({ brandId, regionId, products, bindings });
    res.json(result);
  });

  // GET /callback — OAuth redirect from Google (no bearer, browser redirect)
  router.get("/callback", async (req, res) => {
    const { code, state } = req.query as { code?: string; state?: string };

    if (!code || !state) {
      res.status(400).json({
        error: "invalid_request",
        message: "Missing required query parameters: code and state."
      });
      return;
    }

    // Dispatch: account flow uses acct_ prefix; per-brand flow does not.
    if (state.startsWith("acct_") && accountStore) {
      try {
        const { account } = await adapter.completeAccountFlow({ code, state }, accountStore);
        // Browser redirect — navigate back to admin so sessionStorage drawerReturn can restore the drawer
        const accountId = account?.id ?? "";
        res.redirect(`/admin?oauth_account=${encodeURIComponent(accountId)}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.redirect(`/admin?oauth_error=${encodeURIComponent(message)}`);
      }
      return;
    }

    try {
      const result = await adapter.completeFlow({ code, state });
      const credential = stripEncryptedPayload(
        result.credential as GoogleOAuthCredential & { encryptedPayload: string }
      );
      res.json({ credential, bindings: result.bindings });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "Invalid or expired OAuth state") {
        res.status(400).json({ error: "invalid_state", message });
        return;
      }
      res.status(502).json({ error: "upstream_error", message });
    }
  });

  // DELETE /credentials/:id — delete a credential and its bindings
  router.delete("/credentials/:id", requireBearer, (req, res) => {
    const existing = store.getCredential(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "not_found", message: "Credential not found." });
      return;
    }
    store.deleteCredential(req.params.id);
    res.json({ deleted: true, id: req.params.id });
  });

  // POST /credentials/:id/refresh — refresh token if needed
  router.post("/credentials/:id/refresh", requireBearer, async (req, res) => {
    const existing = store.getCredential(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "not_found", message: "Credential not found." });
      return;
    }

    try {
      const refreshed = await adapter.refreshTokenIfNeeded(req.params.id, fetch, accountStore);
      const updated = store.getCredential(req.params.id);
      const credential = updated ? stripEncryptedPayload(updated) : null;
      res.json({ refreshed, credential });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: "upstream_error", message });
    }
  });

  // ── Account-level routes ──────────────────────────────────────────────────────

  // POST /account/start — one consent for the whole admin account
  router.post("/account/start", (_req, res) => {
    if (!accountStore) {
      res.status(501).json({ error: "not_configured", message: "Account store not configured." });
      return;
    }
    const result = adapter.startAccountFlow();
    res.json(result);
  });

  // GET /account/link-plan — preview which connections will be linked
  router.get("/account/link-plan", requireBearer, async (req, res) => {
    if (!accountStore || !linker) {
      res.status(501).json({ error: "not_configured", message: "Linker not configured." });
      return;
    }

    let accountId = req.query.accountId as string | undefined;
    if (!accountId) {
      const accounts = accountStore.listAccounts("google");
      if (accounts.length === 1) {
        accountId = accounts[0].id;
      } else if (accounts.length === 0) {
        res.status(404).json({ error: "not_found", message: "No Google account found. Run /account/start first." });
        return;
      } else {
        res.status(400).json({ error: "invalid_input", message: "Multiple Google accounts found; provide accountId." });
        return;
      }
    }

    try {
      const plan = await linker.buildPlan(accountId);
      res.json(plan);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string }).code;
      if (code === "not_found") {
        res.status(404).json({ error: "not_found", message });
        return;
      }
      if (code === "conflict") {
        res.status(409).json({ error: "conflict", message });
        return;
      }
      res.status(502).json({ error: "upstream_error", message });
    }
  });

  // POST /account/link — confirm and provision links
  router.post("/account/link", requireBearer, async (req, res) => {
    if (!accountStore || !linker) {
      res.status(501).json({ error: "not_configured", message: "Linker not configured." });
      return;
    }

    const body = req.body as GoogleLinkRequest & { accountId?: string };
    let accountId = body.accountId;
    if (!accountId) {
      const accounts = accountStore.listAccounts("google");
      if (accounts.length === 1) {
        accountId = accounts[0].id;
      } else if (accounts.length === 0) {
        res.status(404).json({ error: "not_found", message: "No Google account found." });
        return;
      } else {
        res.status(400).json({ error: "invalid_input", message: "Multiple accounts; provide accountId." });
        return;
      }
    }

    if (body.connectionIds !== undefined && !Array.isArray(body.connectionIds)) {
      res.status(400).json({ error: "invalid_input", message: "connectionIds must be an array." });
      return;
    }

    try {
      const result = await linker.applyLinks(accountId, { connectionIds: body.connectionIds });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string }).code;
      if (code === "not_found") {
        res.status(404).json({ error: "not_found", message });
        return;
      }
      if (code === "conflict") {
        res.status(409).json({ error: "conflict", message });
        return;
      }
      res.status(502).json({ error: "upstream_error", message });
    }
  });

  return router;
}
