import type { Request, Response, NextFunction } from "express";

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function bearerAuth(expectedBearer: string) {
  if (!expectedBearer || expectedBearer.length < 16) {
    throw new Error("GATEWAY_BEARER must be at least 16 characters");
  }
  return function (req: Request, res: Response, next: NextFunction): void {
    const header = req.header("authorization") ?? "";
    if (!header.toLowerCase().startsWith("bearer ")) {
      res.status(401).json({ error: "missing bearer token" });
      return;
    }
    const token = header.slice("bearer ".length).trim();
    if (!timingSafeStringEqual(token, expectedBearer)) {
      res.status(401).json({ error: "invalid bearer token" });
      return;
    }
    next();
  };
}

const USER_ID_PATTERN = /^[A-Za-z0-9_\-.]{1,128}$/;

export interface ActorContext {
  userId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: ActorContext;
    }
  }
}

export function actorContext(defaultUserId: string) {
  return function (req: Request, res: Response, next: NextFunction): void {
    const headerVal = req.header("x-composio-user-id");
    const userId = (headerVal && headerVal.trim()) || defaultUserId;
    if (!USER_ID_PATTERN.test(userId)) {
      res.status(400).json({ error: "invalid X-Composio-User-Id header" });
      return;
    }
    req.actor = { userId };
    next();
  };
}
