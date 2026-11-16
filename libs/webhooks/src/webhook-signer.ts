import { hmacSha256Hex, safeEqual } from '@app/common';

/**
 * Signature scheme for the reservation status webhook (DESIGN.md §4.5):
 *   x-booking-signature: sha256=<hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)>
 */
export function signWebhook(secret: string, timestamp: number, rawBody: string): string {
  return `sha256=${hmacSha256Hex(secret, `${timestamp}.${rawBody}`)}`;
}

/** Reference verifier for receivers (also used in tests). Rejects timestamps older than maxAgeS. */
export function verifyWebhook(
  secret: string,
  headers: { timestamp: string | undefined; signature: string | undefined },
  rawBody: string,
  nowS = Math.floor(Date.now() / 1000),
  maxAgeS = 300,
): boolean {
  const ts = Number(headers.timestamp);
  if (!Number.isInteger(ts) || !headers.signature) return false;
  if (Math.abs(nowS - ts) > maxAgeS) return false;
  return safeEqual(headers.signature, signWebhook(secret, ts, rawBody));
}
