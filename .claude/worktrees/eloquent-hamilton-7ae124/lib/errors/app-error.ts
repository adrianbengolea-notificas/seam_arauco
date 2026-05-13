export type AppErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: AppErrorCode,
    message: string,
    options?: { status?: number; details?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.details = options?.details;
    this.status =
      options?.status ??
      (code === "UNAUTHORIZED"
        ? 401
        : code === "FORBIDDEN"
          ? 403
          : code === "NOT_FOUND"
            ? 404
            : code === "CONFLICT"
              ? 409
              : code === "VALIDATION"
                ? 422
                : 500);
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
