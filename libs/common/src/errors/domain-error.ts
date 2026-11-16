import { ERROR_HTTP_STATUS, ErrorCode } from './error-codes';

export interface ErrorDetail {
  field?: string;
  issue: string;
}

/**
 * An expected failure with a stable code. The global exception filter turns it into
 * `{ error: { code, message, request_id, details } }` with the mapped HTTP status.
 */
export class DomainError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: ErrorDetail[] = [],
    /** Extra context for logs only. Never sent to the client. */
    readonly internal?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
    this.status = ERROR_HTTP_STATUS[code];
  }
}
