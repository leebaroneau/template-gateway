export class AdminBackendError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "AdminBackendError";
    this.statusCode = statusCode;
  }
}

export function statusCodeForAdminError(error: unknown): number {
  if (error instanceof AdminBackendError) {
    return error.statusCode;
  }
  return 400;
}
