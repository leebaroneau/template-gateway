import express from "express";
import type { NextFunction, Request, Response } from "express";
import { verifyWebhookHmac } from "./hmac.js";
import type { ShopifyOAuthConfig } from "./adapter.js";
import type { ShopifyOAuthAdapter } from "./adapter.js";
import type { GatewayShopifyStore } from "./store.js";

export interface CreateShopifyOAuthRouterOptions {
  config: ShopifyOAuthConfig | undefined;
  adapter: ShopifyOAuthAdapter | undefined;
  store: GatewayShopifyStore | undefined;
  bearer: string;
}

function stripEncryptedPayload<T extends { encryptedPayload?: string }>(
  obj: T
): Omit<T, "encryptedPayload"> {
  const { encryptedPayload: _ep, ...rest } = obj as T & { encryptedPayload?: string };
  return rest as Omit<T, "encryptedPayload">;
}

export function createShopifyOAuthRouter(
  options: CreateShopifyOAuthRouterOptions
): express.Router {
  const router = express.Router();

  // 501 guard — BEFORE any express.json() or express.raw()
  if (!options.config || !options.adapter || !options.store) {
    router.use((_req, res) => {
      res.status(501).json({
        error: "not_configured",
        message: "Shopify OAuth is not configured on this gateway instance."
      });
    });
    return router;
  }

  const { adapter, store, bearer } = options;

  // requireBearer middleware
  function requireBearer(req: Request, res: Response, next: NextFunction): void {
    if (req.get("Authorization") !== `Bearer ${bearer}`) {
      res.status(401).json({ error: "unauthorized", message: "Bearer token required." });
      return;
    }
    next();
  }

  // IMPORTANT: webhook route must use express.raw() — register it BEFORE express.json()
  // so the body parser doesn't consume the raw bytes needed for HMAC verification
  router.post(
    "/webhooks",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      const rawBody = req.body as Buffer;
      const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
      const topic = req.get("X-Shopify-Topic") ?? "";
      const shop = req.get("X-Shopify-Shop-Domain") ?? "";

      if (!verifyWebhookHmac(rawBody, hmacHeader, options.config!.apiSecret)) {
        res.status(401).json({ error: "unauthorized", message: "Invalid HMAC." });
        return;
      }

      const webhookId = req.get("X-Shopify-Webhook-Id") ?? "";
      try {
        if (topic === "app/uninstalled") {
          adapter.handleUninstall(shop);
        } else if (topic === "shop/redact") {
          adapter.handleShopRedact(shop);
        } else if (topic === "customers/data_request" || topic === "customers/redact") {
          // Gateway stores no customer PII; audit receipt of compliance webhook.
          // eslint-disable-next-line no-console
          console.warn(`[shopify-oauth] compliance webhook received topic=${topic} shop=${shop} webhookId=${webhookId}`);
        } else {
          // eslint-disable-next-line no-console
          console.warn(`[shopify-oauth] unhandled webhook topic=${topic} shop=${shop} webhookId=${webhookId}`);
        }
        res.status(200).json({ ok: true });
      } catch {
        res.status(200).json({ ok: true }); // always ack on valid HMAC
      }
    }
  );

  // Now mount JSON middleware for the rest of the routes
  router.use(express.json());

  // GET /credentials — list all credentials without encryptedPayload
  router.get("/credentials", requireBearer, (_req, res) => {
    const credentials = store.listCredentials().map(stripEncryptedPayload);
    res.json({ credentials });
  });

  // GET /credentials/:id — get single credential
  router.get("/credentials/:id", requireBearer, (req, res) => {
    const credential = store.getCredential(req.params.id);
    if (!credential) {
      res.status(404).json({ error: "not_found", message: "Credential not found." });
      return;
    }
    res.json({ credential: stripEncryptedPayload(credential) });
  });

  // POST /install — start the OAuth flow
  router.post("/install", (req, res) => {
    const { shop } = req.body ?? {};
    if (!shop || typeof shop !== "string") {
      res.status(400).json({ error: "invalid_input", message: "shop is required." });
      return;
    }
    try {
      const result = adapter.startFlow({ shop });
      res.json(result);
    } catch (err) {
      res
        .status(400)
        .json({
          error: "invalid_input",
          message: err instanceof Error ? err.message : "Invalid request."
        });
    }
  });

  // GET /callback — no Bearer (browser redirect from Shopify)
  router.get("/callback", async (req, res) => {
    const { shop, code, state, hmac } = req.query as Record<string, string>;
    if (!shop || !code || !state || !hmac) {
      res
        .status(400)
        .json({ error: "invalid_request", message: "Missing required callback parameters." });
      return;
    }
    try {
      const queryParams = req.query as Record<string, string>;
      const result = await adapter.completeFlow({ code, state, shop, hmac, queryParams });
      res.json({ credential: result.credential });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "Invalid HMAC") {
        res.status(400).json({ error: "invalid_hmac", message: "HMAC verification failed." });
      } else if (msg.startsWith("Invalid or expired")) {
        res
          .status(400)
          .json({ error: "invalid_state", message: "OAuth state is invalid or expired." });
      } else {
        res.status(502).json({ error: "upstream_error", message: msg });
      }
    }
  });

  // DELETE /credentials/:id
  router.delete("/credentials/:id", requireBearer, (req, res) => {
    const credential = store.getCredential(req.params.id);
    if (!credential) {
      res.status(404).json({ error: "not_found", message: "Credential not found." });
      return;
    }
    store.deleteCredential(req.params.id);
    res.json({ deleted: true, id: req.params.id });
  });

  return router;
}
