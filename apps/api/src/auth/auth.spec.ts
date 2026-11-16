import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { JWTVerifyGetKey, KeyLike } from 'jose';
import { DomainError, Env, ErrorCode, getRequestContext, getServiceToken } from '@app/common';
import { generateApiKey, hashApiKey, parseApiKey } from './api-key.util';
import { ServiceAuthGuard } from './service-auth.guard';

describe('API key format', () => {
  it('generates keys that parse and hash consistently', () => {
    const { key, prefix } = generateApiKey('test');
    expect(key).toMatch(/^bks_test_[a-z0-9]{8}_[A-Za-z0-9]{43}$/);
    expect(parseApiKey(key)).toEqual({ env: 'test', prefix });
    expect(hashApiKey(key, 'p'.repeat(32))).toBe(hashApiKey(key, 'p'.repeat(32)));
    expect(hashApiKey(key, 'p'.repeat(32))).not.toBe(hashApiKey(key, 'q'.repeat(32)));
  });

  it('rejects malformed keys', () => {
    expect(parseApiKey(undefined)).toBeNull();
    expect(parseApiKey('bks_prod_abcdefgh_xxx')).toBeNull();
    expect(parseApiKey('not-a-key')).toBeNull();
  });
});

describe('ServiceAuthGuard', () => {
  const ISSUER = 'https://issuer.test/';
  const AUDIENCE = 'booking-service';
  let privateKey: KeyLike;
  let jwks: JWTVerifyGetKey;
  let audit: { record: jest.Mock };

  const env = {
    SERVICE_AUTH_HEADER: 'authorization',
    SERVICE_AUTH_ISSUER: ISSUER,
    SERVICE_AUTH_AUDIENCE: AUDIENCE,
    SERVICE_AUTH_ALGORITHMS: ['RS256', 'ES256'],
    SERVICE_AUTH_CLOCK_SKEW_S: 30,
    SERVICE_AUTH_TENANT_CLAIM: 'tenant',
    USER_REF_SECRET: 'u'.repeat(32),
  } as unknown as Env;

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    jwks = createLocalJWKSet({ keys: [publicJwk] });
  });

  beforeEach(() => {
    audit = { record: jest.fn().mockResolvedValue(undefined) };
  });

  function sign(claims: Record<string, unknown> = {}, opts: { exp?: string | number; aud?: string; iss?: string } = {}) {
    return new SignJWT({ tenant: 'spice', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setSubject('user-42')
      .setIssuer(opts.iss ?? ISSUER)
      .setAudience(opts.aud ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? '5m')
      .sign(privateKey);
  }

  function context(headers: Record<string, string>, tenant: string | null = 'spice') {
    const req = { raw: { headers }, headers, ip: '127.0.0.1' } as never;
    getRequestContext(req).apiClient = {
      clientId: 'c1',
      clientName: 'Spice backend',
      keyId: 'k1',
      keyPrefix: 'abcd1234',
      scopes: ['reservations:write'],
      tenant,
    };
    const ctx = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    return { ctx, req };
  }

  function guard() {
    const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
    return new ServiceAuthGuard(reflector, env, jwks, audit as never);
  }

  async function expectCode(promise: Promise<unknown>, code: ErrorCode) {
    await expect(promise).rejects.toBeInstanceOf(DomainError);
    await promise.catch((err: DomainError) => expect(err.code).toBe(code));
  }

  it('accepts a valid token, sets the principal and keeps the token off the context', async () => {
    const token = await sign();
    const { ctx, req } = context({ authorization: `Bearer ${token}` });
    await expect(guard().canActivate(ctx)).resolves.toBe(true);
    const rc = getRequestContext(req);
    expect(rc.principal?.subject).toBe('user-42');
    expect(rc.principal?.userRef).toMatch(/^usr_/);
    expect(getServiceToken(req)).toBe(token);
    expect(JSON.stringify(rc)).not.toContain(token);
  });

  it('rejects a missing token with SERVICE_AUTH_REQUIRED and audits it', async () => {
    const { ctx } = context({});
    await expectCode(guard().canActivate(ctx), ErrorCode.SERVICE_AUTH_REQUIRED);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.denied', outcome: 'denied' }));
  });

  it('rejects an expired token', async () => {
    const token = await sign({}, { exp: Math.floor(Date.now() / 1000) - 120 });
    await expectCode(guard().canActivate(context({ authorization: `Bearer ${token}` }).ctx), ErrorCode.INVALID_SERVICE_TOKEN);
    expect(audit.record.mock.calls[0][0].metadata.reason).toBe('expired');
  });

  it('rejects the wrong audience and issuer', async () => {
    const badAud = await sign({}, { aud: 'someone-else' });
    await expectCode(guard().canActivate(context({ authorization: `Bearer ${badAud}` }).ctx), ErrorCode.INVALID_SERVICE_TOKEN);
    const badIss = await sign({}, { iss: 'https://evil.test/' });
    await expectCode(guard().canActivate(context({ authorization: `Bearer ${badIss}` }).ctx), ErrorCode.INVALID_SERVICE_TOKEN);
  });

  it('rejects HS256 tokens even when correctly signed', async () => {
    const hs = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-42')
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('x'.repeat(32)));
    await expectCode(guard().canActivate(context({ authorization: `Bearer ${hs}` }).ctx), ErrorCode.INVALID_SERVICE_TOKEN);
  });

  it('rejects a token from another tenant with FORBIDDEN', async () => {
    const token = await sign({ tenant: 'other' });
    await expectCode(guard().canActivate(context({ authorization: `Bearer ${token}` }).ctx), ErrorCode.FORBIDDEN);
  });
});
