import { randomBytes } from 'crypto';
import { hmacSha256Hex } from '@app/common';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export const KEY_PATTERN = /^bks_(live|test)_([a-z0-9]{8})_([A-Za-z0-9]{40,64})$/;

export const SCOPES = ['shifts:read', 'reservations:write', 'reservations:read', 'admin'] as const;
export type Scope = (typeof SCOPES)[number];

function randomFrom(alphabet: string, length: number): string {
  const bytes = randomBytes(length * 2);
  let out = '';
  // Rejection sampling keeps every character equally likely.
  const limit = 256 - (256 % alphabet.length);
  for (let i = 0; i < bytes.length && out.length < length; i++) {
    if (bytes[i] < limit) out += alphabet[bytes[i] % alphabet.length];
  }
  return out.length === length ? out : randomFrom(alphabet, length);
}

export interface GeneratedKey {
  key: string;
  prefix: string;
}

/** `bks_<env>_<prefix>_<secret>`: prefix is stored in clear for lookup and logs (DESIGN.md §3). */
export function generateApiKey(env: 'live' | 'test'): GeneratedKey {
  const prefix = randomFrom(ALPHABET, 8);
  const secret = randomFrom(BASE62, 43); // ~256 bits
  return { key: `bks_${env}_${prefix}_${secret}`, prefix };
}

export function parseApiKey(value: string | undefined): { env: string; prefix: string } | null {
  if (!value) return null;
  const m = KEY_PATTERN.exec(value);
  return m ? { env: m[1], prefix: m[2] } : null;
}

/** Keys are long random values, so a peppered SHA-256 HMAC is enough; no slow hash needed. */
export function hashApiKey(key: string, pepper: string): string {
  return hmacSha256Hex(pepper, key);
}
