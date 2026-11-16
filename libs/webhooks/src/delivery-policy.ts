export const WEBHOOK_BASE_BACKOFF_MS = 30_000;

export type DeliveryDecision = 'delivered' | 'retry' | 'dead';

/**
 * What to do after one delivery attempt.
 * - 2xx: delivered
 * - 4xx other than 408/429: permanent, retrying won't help → dead
 * - anything else (5xx, 408, 429, timeout, network): retry until attempts run out → dead
 */
export function decideDelivery(httpStatus: number | null, attempt: number, maxAttempts: number): DeliveryDecision {
  if (httpStatus !== null && httpStatus >= 200 && httpStatus < 300) return 'delivered';
  const permanent = httpStatus !== null && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408 && httpStatus !== 429;
  if (permanent) return 'dead';
  return attempt >= maxAttempts ? 'dead' : 'retry';
}

/** Delay before the next attempt: 30 s, 1, 2, 4, 8, 16, 32 min… (matches BullMQ exponential backoff). */
export function backoffMs(attempt: number): number {
  return WEBHOOK_BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1);
}
