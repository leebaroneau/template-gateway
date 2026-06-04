export class AdminBackendError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "AdminBackendError";
    this.statusCode = statusCode;
  }
}

function hasStatusCode(error: unknown): error is { statusCode: number } {
  return Boolean(
    error && typeof error === "object" && typeof (error as { statusCode?: unknown }).statusCode === "number"
  );
}

export function statusCodeForAdminError(error: unknown): number {
  if (error instanceof AdminBackendError || hasStatusCode(error)) {
    return error.statusCode;
  }
  return 400;
}
