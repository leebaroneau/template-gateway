export class AdminBackendError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "AdminBackendError";
    this.statusCode = statusCode;
  }
}

function isValidHttpErrorStatus(statusCode: unknown): statusCode is number {
  return typeof statusCode === "number" && Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599;
}

function hasStatusCode(error: unknown): error is { statusCode: number } {
  const statusCode = error && typeof error === "object" ? (error as { statusCode?: unknown }).statusCode : undefined;
  return isValidHttpErrorStatus(statusCode);
}

export function statusCodeForAdminError(error: unknown): number {
  if (error instanceof AdminBackendError) {
    return isValidHttpErrorStatus(error.statusCode) ? error.statusCode : 400;
  }
  if (hasStatusCode(error)) {
    return error.statusCode;
  }
  return 400;
}
