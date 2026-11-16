import { BookingFailureCode } from '@app/common';
import type { BookingRequest, BookingResult } from '@app/providers';
import type { BookingFailure } from '@app/webhooks';

export type SubmitDecision =
  | { kind: 'confirmed'; confirmationCode: string }
  | { kind: 'retry'; reason: string }
  | { kind: 'failed'; failure: BookingFailure };

/**
 * What to do with a provider result (DESIGN.md §4.2):
 * - confirmed, and the confirmation screen matches the request → confirmed
 * - confirmed, but date/time/party size differ → failed CONFIRMATION_MISMATCH (submitted)
 * - failed before the confirm click, retryable, attempts left → retry
 * - anything else → failed, reported through the webhook
 */
export function decideSubmit(
  result: BookingResult,
  request: Pick<BookingRequest, 'date' | 'time' | 'partySize'>,
  attempt: number,
  maxAttempts: number,
): SubmitDecision {
  if (result.status === 'confirmed') {
    const c = result.confirmed;
    if (c.date !== request.date || c.time !== request.time || c.partySize !== request.partySize) {
      return {
        kind: 'failed',
        failure: {
          errorCode: BookingFailureCode.CONFIRMATION_MISMATCH,
          message: `Confirmation showed ${c.date} ${c.time} for ${c.partySize}; requested ${request.date} ${request.time} for ${request.partySize}.`,
          submitted: true,
        },
      };
    }
    return { kind: 'confirmed', confirmationCode: result.confirmationCode };
  }

  if (result.retryable && !result.submitted && attempt < maxAttempts) {
    return { kind: 'retry', reason: `${result.errorCode}: ${result.message}` };
  }

  return {
    kind: 'failed',
    failure: { errorCode: result.errorCode, message: result.message, submitted: result.submitted },
  };
}

/** Failure codes that also get an error_logs row (someone may need to act on them). */
export const LOGGED_FAILURES = new Set<BookingFailureCode>([
  BookingFailureCode.SCRIPT_FAILED,
  BookingFailureCode.CONFIRMATION_MISMATCH,
  BookingFailureCode.OUTCOME_UNKNOWN,
  BookingFailureCode.PLATFORM_UNAVAILABLE,
  BookingFailureCode.INTERNAL_ERROR,
]);
