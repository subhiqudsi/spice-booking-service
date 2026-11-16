import { hmacSha256Base64Url, safeEqual } from './crypto';
import { DomainError } from './errors/domain-error';
import { ErrorCode } from './errors/error-codes';

/** What a slot token carries (DESIGN.md §4.1). Short keys keep the token small. */
export interface SlotTokenPayload {
  /** restaurant id */
  r: string;
  /** platform */
  p: string;
  /** venue id */
  v: string;
  /** venue-local date YYYY-MM-DD */
  d: string;
  /** venue-local time HH:mm */
  t: string;
  /** shift id */
  s: string;
  /** party size */
  n: number;
  /** expiry, unix seconds */
  exp: number;
}

export function signSlotToken(secret: string, payload: SlotTokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmacSha256Base64Url(secret, body)}`;
}

export function verifySlotToken(secret: string, token: string, nowMs = Date.now()): SlotTokenPayload {
  const invalid = (issue: string) =>
    new DomainError(ErrorCode.INVALID_SLOT_TOKEN, 'slot_token is invalid or expired.', [
      { field: 'slot_token', issue },
    ]);

  const [body, sig] = token.split('.');
  if (!body || !sig) throw invalid('malformed');
  if (!safeEqual(sig, hmacSha256Base64Url(secret, body))) throw invalid('bad signature');

  let payload: SlotTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SlotTokenPayload;
  } catch {
    throw invalid('malformed');
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < nowMs) throw invalid('expired');
  return payload;
}
