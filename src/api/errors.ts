import type { Response } from "express";

export type GatewayApiErrorCode = "unauthorized" | "forbidden" | "not_found" | "invalid_request" | "internal_error";

export class GatewayApiError extends Error {
  readonly statusCode: number;
  readonly code: GatewayApiErrorCode;

  constructor(statusCode: number, code: GatewayApiErrorCode, message: string) {
    super(message);
    this.name = "GatewayApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function sendGatewayApiError(res: Response, error: unknown): void {
  if (error instanceof GatewayApiError) {
    res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  res.status(500).json({ error: { code: "internal_error", message } });
}
