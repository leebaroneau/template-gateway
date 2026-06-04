export class AdminBackendError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "AdminBackendError";
    this.statusCode = statusCode;
  }
}

function hasStatusCode(error: unknown): error is { statusCode: number } {
  const statusCode = error && typeof error === "object" ? (error as { statusCode?: unknown }).statusCode : undefined;
  return Boolean(
    typeof statusCode === "number" && Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599
  );
}

export function statusCodeForAdminError(error: unknown): number {
  if (error instanceof AdminBackendError || hasStatusCode(error)) {
    return error.statusCode;
  }
  return 400;
}
