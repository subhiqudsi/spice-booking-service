import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmacSha256Hex(secret: string, input: string): string {
  return createHmac('sha256', secret).update(input).digest('hex');
}

export function hmacSha256Base64Url(secret: string, input: string): string {
  return createHmac('sha256', secret).update(input).digest('base64url');
}

/** Constant-time comparison of two strings. Returns false on length mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** JSON with sorted keys, so the same object always hashes the same. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/**
 * AES-256-GCM for data that must cross the queue (contact details).
 * Format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
 */
export function encryptJson(keyBase64: string, value: unknown): string {
  const key = Buffer.from(keyBase64, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptJson<T>(keyBase64: string, payload: string): T {
  const [version, ivPart, tagPart, dataPart] = payload.split('.');
  if (version !== 'v1' || !ivPart || !tagPart || !dataPart) {
    throw new Error('Unsupported encrypted payload format');
  }
  const key = Buffer.from(keyBase64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}

/** Stable, non-reversible reference to an end user for logs and audit rows. */
export function userRef(secret: string, issuer: string, subject: string): string {
  return `usr_${hmacSha256Hex(secret, `${issuer}|${subject}`).slice(0, 32)}`;
}
