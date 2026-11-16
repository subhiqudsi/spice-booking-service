import { CanActivate, ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { errors, JWTPayload, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import { APP_ENV, DomainError, Env, ErrorCode, getRequestContext, setServiceToken, userRef } from '@app/common';
import { AuditService } from '@app/audit';
import { PUBLIC_META } from './decorators';

/** Injection token for the JWKS key resolver (remote in production, local in tests). */
export const JWKS_RESOLVER = Symbol('JWKS_RESOLVER');

type Rejection = { code: ErrorCode; reason: string };

/** Maps jose errors to a client code and a log-safe reason (never the token). */
export function classifyJwtError(err: unknown): Rejection {
  const invalid = (reason: string) => ({ code: ErrorCode.INVALID_SERVICE_TOKEN, reason });
  if (err instanceof errors.JWTExpired) return invalid('expired');
  if (err instanceof errors.JWTClaimValidationFailed) {
    if (err.claim === 'aud') return invalid('wrong_audience');
    if (err.claim === 'iss') return invalid('wrong_issuer');
    if (err.claim === 'nbf') return invalid('not_yet_valid');
    return invalid(`bad_claim_${err.claim}`);
  }
  if (err instanceof errors.JWSSignatureVerificationFailed) return invalid('bad_signature');
  if (err instanceof errors.JOSEAlgNotAllowed) return invalid('algorithm_not_allowed');
  if (err instanceof errors.JWKSNoMatchingKey) return invalid('unknown_kid');
  if (err instanceof errors.JWSInvalid || err instanceof errors.JWTInvalid) return invalid('malformed');
  if (err instanceof errors.JWKSTimeout || err instanceof errors.JWKSInvalid) {
    return { code: ErrorCode.SERVICE_AUTH_UNAVAILABLE, reason: 'jwks_unavailable' };
  }
  if (err instanceof errors.JOSEError) return invalid(err.code ?? 'invalid');
  // fetch() failures while refreshing the JWKS land here
  return { code: ErrorCode.SERVICE_AUTH_UNAVAILABLE, reason: 'jwks_unavailable' };
}

/**
 * Second auth layer: a JWT from the other services, validated locally against the issuer's JWKS
 * on every call (DESIGN.md §3.1). The raw token is kept only for DownstreamHttpClient.
 */
@Injectable()
export class ServiceAuthGuard implements CanActivate {
  private readonly logger = new Logger(ServiceAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_ENV) private readonly env: Env,
    @Inject(JWKS_RESOLVER) private readonly keys: JWTVerifyGetKey,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_META, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const ctx = getRequestContext(req);

    const token = this.extractToken(req);
    if (!token) {
      await this.deny(ctx, 'missing');
      throw new DomainError(ErrorCode.SERVICE_AUTH_REQUIRED, `The ${this.env.SERVICE_AUTH_HEADER} header with a service token is required.`);
    }

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.keys, {
        issuer: this.env.SERVICE_AUTH_ISSUER,
        audience: this.env.SERVICE_AUTH_AUDIENCE,
        algorithms: this.env.SERVICE_AUTH_ALGORITHMS,
        clockTolerance: this.env.SERVICE_AUTH_CLOCK_SKEW_S,
        requiredClaims: ['sub', 'exp'],
      }));
    } catch (err) {
      const rejection = classifyJwtError(err);
      this.logger.warn({ requestId: ctx.requestId, reason: rejection.reason }, 'service token rejected');
      await this.deny(ctx, rejection.reason);
      throw new DomainError(
        rejection.code,
        rejection.code === ErrorCode.SERVICE_AUTH_UNAVAILABLE
          ? 'Service token keys are unavailable right now. Try again shortly.'
          : 'The service token is invalid or expired.',
      );
    }

    // Optional binding: the token's tenant must match the API key's client.
    const tenantClaim = this.env.SERVICE_AUTH_TENANT_CLAIM;
    const clientTenant = ctx.apiClient?.tenant;
    if (tenantClaim && clientTenant && payload[tenantClaim] !== clientTenant) {
      await this.deny(ctx, 'tenant_mismatch');
      throw new DomainError(ErrorCode.FORBIDDEN, 'The service token does not belong to this API client.');
    }

    const subject = payload.sub as string;
    const issuer = (payload.iss as string) ?? this.env.SERVICE_AUTH_ISSUER;
    ctx.principal = { subject, issuer, userRef: userRef(this.env.USER_REF_SECRET, issuer, subject), claims: payload };
    setServiceToken(req, token);
    return true;
  }

  private extractToken(req: FastifyRequest): string | undefined {
    const raw = req.headers[this.env.SERVICE_AUTH_HEADER];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!value) return undefined;
    const bearer = /^Bearer\s+(.+)$/i.exec(value);
    if (bearer) return bearer[1].trim();
    return this.env.SERVICE_AUTH_HEADER === 'authorization' ? undefined : value;
  }

  private deny(ctx: ReturnType<typeof getRequestContext>, reason: string): Promise<void> {
    return this.audit.record({
      ...AuditService.fromContext(ctx),
      action: 'auth.denied',
      outcome: 'denied',
      metadata: { layer: 'service_token', reason },
    });
  }
}
