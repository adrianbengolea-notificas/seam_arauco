import type { AppError } from "@/lib/errors/app-error";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { message: string; code: string; details?: Record<string, unknown> } };

export function success<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function failure(err: AppError): ActionResult<never> {
  return {
    ok: false,
    error: {
      code: err.code,
      message: err.message,
      details: err.details,
    },
  };
}
