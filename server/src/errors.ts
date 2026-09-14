import type { ApiError, ApiErrorCode } from '@savit/shared';

export class HttpError extends Error {
  status: number;
  code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function toApiError(err: unknown): { status: number; body: ApiError } {
  if (err instanceof HttpError) {
    return { status: err.status, body: { error: err.message, code: err.code } };
  }

  // Fastify-native 4xx (e.g. malformed JSON body) -> INVALID_INPUT
  const maybeFastifyError = err as { statusCode?: number; message?: string };
  if (
    typeof maybeFastifyError?.statusCode === 'number' &&
    maybeFastifyError.statusCode >= 400 &&
    maybeFastifyError.statusCode < 500
  ) {
    return {
      status: maybeFastifyError.statusCode,
      body: { error: maybeFastifyError.message ?? 'Invalid request', code: 'INVALID_INPUT' },
    };
  }

  return { status: 500, body: { error: 'Internal server error', code: 'DB_ERROR' } };
}
