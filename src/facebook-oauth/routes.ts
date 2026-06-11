import express from "express";
import type { FacebookOAuthAdapter } from "./adapter.js";
import type { FacebookOAuthConfig } from "./adapter.js";
import type { GatewayAccountStore } from "../account-credentials/store.js";

export interface CreateFacebookOAuthRouterOptions {
  config: FacebookOAuthConfig | undefined;
  adapter: FacebookOAuthAdapter | undefined;
  accountStore?: GatewayAccountStore;
}

export function createFacebookOAuthRouter(
  options: CreateFacebookOAuthRouterOptions
): express.Router {
  const router = express.Router();
  router.use(express.json());

  const { config, adapter, accountStore } = options;

  if (!config || !adapter) {
    router.use((_req, res) => {
      res.status(501).json({
        error: "not_configured",
        message: "Facebook OAuth is not configured on this gateway instance."
      });
    });
    return router;
  }

  // POST /account/start — initiate account-level OAuth
  router.post("/account/start", (_req, res) => {
    if (!accountStore) {
      res.status(501).json({ error: "not_configured", message: "Account store not configured." });
      return;
    }
    const result = adapter.startAccountFlow();
    res.json(result);
  });

  // GET /account/callback — Facebook redirects here after consent
  router.get("/account/callback", async (req, res) => {
    const { code, state, error: fbError } = req.query as Record<string, string>;

    if (fbError) {
      res.redirect(`/admin?oauth_error=${encodeURIComponent(fbError)}`);
      return;
    }

    if (!code || !state) {
      res.redirect(`/admin?oauth_error=${encodeURIComponent("Missing code or state from Facebook")}`);
      return;
    }

    if (!accountStore) {
      res.redirect(`/admin?oauth_error=${encodeURIComponent("Account store not configured")}`);
      return;
    }

    try {
      const { account } = await adapter.completeAccountFlow({ code, state }, accountStore, fetch);
      const accountId = account?.id ?? "";
      res.redirect(`/admin?oauth_account=${encodeURIComponent(accountId)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.redirect(`/admin?oauth_error=${encodeURIComponent(message)}`);
    }
  });

  return router;
}
