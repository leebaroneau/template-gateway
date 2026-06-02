import { AdminBackendError } from "./backend-error.js";
import type { DevApiBrandsResponse } from "./dev-api-types.js";

export interface DevApiBrandsClientOptions {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs?: number;
}

export class DevApiBrandsClient {
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly timeoutMs: number;

  constructor(options: DevApiBrandsClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async fetchBrands(): Promise<DevApiBrandsResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/api/internal/brands`, {
        headers: {
          accept: "application/json",
          "x-internal-client-id": this.clientId,
          "x-internal-client-secret": this.clientSecret
        },
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new AdminBackendError(
          502,
          `Haverford Dev API /api/internal/brands failed with ${response.status}: ${sanitizeUpstreamBodyPreview(body)}`
        );
      }

      return (await response.json()) as DevApiBrandsResponse;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AdminBackendError(
          504,
          `Haverford Dev API /api/internal/brands timed out after ${this.timeoutMs}ms`
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

const maxErrorBodyPreviewLength = 160;
const secretAssignmentPattern =
  /\b(?:access[_-]?token|api[_-]?key|authorization|bearer|client[_-]?secret|credential|password|refresh[_-]?token|secret|token)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&}]+)/gi;
const secretLikeWordPattern =
  /\b(?:[a-z0-9._-]*(?:access|authorization|bearer|credential|password|secret|token)[a-z0-9._-]*)\b/gi;

function sanitizeUpstreamBodyPreview(body: string): string {
  const sanitized = body
    .replace(/\s+/g, " ")
    .trim()
    .replace(secretAssignmentPattern, "[redacted]")
    .replace(secretLikeWordPattern, "[redacted]");

  if (!sanitized) {
    return "(empty response body)";
  }
  if (sanitized.length <= maxErrorBodyPreviewLength) {
    return sanitized;
  }
  return `${sanitized.slice(0, maxErrorBodyPreviewLength)}...`;
}
