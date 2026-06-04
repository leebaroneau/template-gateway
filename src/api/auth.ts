import type { NextFunction, Request, Response } from "express";
import type { GatewayAccessStore } from "../access/store.js";
import type { AuthenticatedGatewayApiClient, GatewayApiScope } from "../access/types.js";
import { scopeAllowed } from "../access/types.js";
import { GatewayApiError, sendGatewayApiError } from "./errors.js";

declare module "express-serve-static-core" {
  interface Request {
    gatewayApiAuth?: AuthenticatedGatewayApiClient;
    gatewayApiRequiredScope?: GatewayApiScope;
  }
}

function bearerSecret(req: Request): string | undefined {
  const header = req.get("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match?.[1];
}

export function gatewayApiAuth(accessStore: GatewayAccessStore, requiredScope?: GatewayApiScope) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const secret = bearerSecret(req);
      if (secret === undefined) {
        accessStore.writeAccessAudit({
          action: "api_auth.failed",
          targetType: "api_client",
          targetId: "unknown",
          detail: "Missing bearer token",
          actor: "anonymous",
          metadata: { route: req.originalUrl, method: req.method, reason: "missing_bearer" }
        });
        throw new GatewayApiError(401, "unauthorized", "Missing bearer token");
      }

      const authenticated = accessStore.authenticate(secret);
      if (authenticated === undefined) {
        accessStore.writeAccessAudit({
          action: "api_auth.failed",
          targetType: "api_client",
          targetId: "unknown",
          detail: "Invalid or revoked API key",
          actor: "anonymous",
          metadata: { route: req.originalUrl, method: req.method, reason: "invalid_or_revoked" }
        });
        throw new GatewayApiError(401, "unauthorized", "Invalid or revoked API key");
      }

      req.gatewayApiAuth = authenticated;
      req.gatewayApiRequiredScope = requiredScope;
      accessStore.writeAccessAudit({
        action: "api_auth.succeeded",
        targetType: "api_client",
        targetId: authenticated.client.id,
        detail: `Authenticated ${req.method} ${req.originalUrl}`,
        actor: authenticated.client.id,
        metadata: {
          route: req.originalUrl,
          method: req.method,
          fingerprint: authenticated.key.fingerprint,
          requiredScope: requiredScope ?? ""
        }
      });

      if (requiredScope !== undefined && !scopeAllowed(authenticated.client.scopes, requiredScope)) {
        accessStore.writeAccessAudit({
          action: "api_scope.denied",
          targetType: "api_client",
          targetId: authenticated.client.id,
          detail: `Missing required scope: ${requiredScope}`,
          actor: authenticated.client.id,
          metadata: {
            route: req.originalUrl,
            method: req.method,
            fingerprint: authenticated.key.fingerprint,
            requiredScope
          }
        });
        throw new GatewayApiError(403, "forbidden", `Missing required scope: ${requiredScope}`);
      }

      next();
    } catch (error) {
      sendGatewayApiError(res, error);
    }
  };
}
