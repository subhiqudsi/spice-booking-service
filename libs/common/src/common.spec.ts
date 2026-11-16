import { decryptJson, encryptJson, stableStringify, userRef } from './crypto';
import { signSlotToken, verifySlotToken } from './slot-token';
import { toVenueLocal } from './time';
import { parseEnv } from './config/env.schema';
import { DomainError } from './errors/domain-error';
import { ErrorCode } from './errors/error-codes';

const KEY = Buffer.alloc(32, 7).toString('base64');
const SECRET = 's'.repeat(32);

describe('encryptJson / decryptJson', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const contact = { name: 'Ada', phone: '+971500000000', email: 'ada@example.com' };
    const a = encryptJson(KEY, contact);
    const b = encryptJson(KEY, contact);
    expect(a).not.toEqual(b);
    expect(a).not.toContain('Ada');
    expect(decryptJson(KEY, a)).toEqual(contact);
  });

  it('rejects tampered ciphertext', () => {
    const parts = encryptJson(KEY, { x: 1 }).split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptJson(KEY, parts.join('.'))).toThrow();
  });
});

describe('stableStringify', () => {
  it('is independent of key order and skips undefined', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 }, z: undefined })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });
});

describe('userRef', () => {
  it('is stable and does not contain the subject', () => {
    const ref = userRef(SECRET, 'https://issuer/', 'user-123');
    expect(ref).toBe(userRef(SECRET, 'https://issuer/', 'user-123'));
    expect(ref).not.toContain('user-123');
    expect(ref).toMatch(/^usr_[0-9a-f]{32}$/);
  });
});

describe('slot tokens', () => {
  const payload = { r: 'spice-1', p: 'fake', v: 'venue-1', d: '2026-11-20', t: '19:00', s: 'dinner', n: 4, exp: 2_000_000_000 };

  it('verifies a token it signed', () => {
    expect(verifySlotToken(SECRET, signSlotToken(SECRET, payload), 1_000)).toEqual(payload);
  });

  it('rejects a changed payload', () => {
    const [, sig] = signSlotToken(SECRET, payload).split('.');
    const forged = `${Buffer.from(JSON.stringify({ ...payload, n: 8 })).toString('base64url')}.${sig}`;
    expect(() => verifySlotToken(SECRET, forged)).toThrow(DomainError);
  });

  it('rejects an expired token with INVALID_SLOT_TOKEN', () => {
    const token = signSlotToken(SECRET, { ...payload, exp: 10 });
    try {
      verifySlotToken(SECRET, token, 11_000);
      fail('expected an error');
    } catch (err) {
      expect((err as DomainError).code).toBe(ErrorCode.INVALID_SLOT_TOKEN);
    }
  });
});

describe('toVenueLocal', () => {
  it('converts an instant to the venue time zone', () => {
    expect(toVenueLocal(new Date('2026-11-20T15:00:00Z'), 'Asia/Dubai')).toEqual({ date: '2026-11-20', time: '19:00' });
    expect(toVenueLocal(new Date('2026-11-20T22:30:00Z'), 'Asia/Dubai')).toEqual({ date: '2026-11-21', time: '02:30' });
  });
});

describe('parseEnv', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    API_KEY_PEPPER: SECRET,
    SERVICE_AUTH_JWKS_URL: 'https://issuer.example.com/jwks.json',
    SERVICE_AUTH_ISSUER: 'https://issuer.example.com/',
    SERVICE_AUTH_AUDIENCE: 'booking-service',
    CONTACT_API_BASE_URL: 'https://contacts.example.com',
    CONTACT_API_CONTACT_PATH: '/v1/me/contact',
    RESERVATION_WEBHOOK_URL: 'https://hooks.example.com/reservations',
    RESERVATION_WEBHOOK_SECRET: SECRET,
    SLOT_TOKEN_SECRET: SECRET,
    USER_REF_SECRET: SECRET,
    JOB_ENCRYPTION_KEY: KEY,
  };

  it('applies defaults', () => {
    const env = parseEnv(base);
    expect(env.SERVICE_AUTH_ALGORITHMS).toEqual(['RS256', 'ES256']);
    expect(env.RESERVATION_WEBHOOK_MAX_ATTEMPTS).toBe(8);
    expect(env.SERVICE_AUTH_HEADER).toBe('authorization');
    expect(env.DOWNSTREAM_ALLOWLIST).toEqual([]);
  });

  it('refuses to boot without the reservation webhook URL', () => {
    const { RESERVATION_WEBHOOK_URL: _omit, ...rest } = base;
    expect(() => parseEnv(rest)).toThrow(/RESERVATION_WEBHOOK_URL/);
  });

  it('refuses symmetric JWT algorithms', () => {
    expect(() => parseEnv({ ...base, SERVICE_AUTH_ALGORITHMS: 'RS256,HS256' })).toThrow(/asymmetric/);
  });
});
