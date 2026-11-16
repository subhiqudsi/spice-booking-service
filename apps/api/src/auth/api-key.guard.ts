import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { DomainError, ErrorCode, getRequestContext } from '@app/common';
import { AuditService } from '@app/audit';
import { ApiKeysService } from './api-keys.service';
import { PUBLIC_META, SCOPES_META } from './decorators';
import type { Scope } from './api-key.util';

/** First auth layer: `x-api-key` identifies the calling system and its scopes (DESIGN.md §3). */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly keys: ApiKeysService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_META, targets)) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const ctx = getRequestContext(req);
    const header = req.headers['x-api-key'];
    const result = await this.keys.verify(Array.isArray(header) ? header[0] : header);

    if (!result.ok) {
      await this.deny(ctx, result.reason, result.prefix);
      throw new DomainError(ErrorCode.UNAUTHORIZED, 'A valid x-api-key header is required.');
    }

    const { key } = result;
    ctx.apiClient = {
      clientId: key.clientId,
      clientName: key.client.name,
      keyId: key.id,
      keyPrefix: key.prefix,
      scopes: key.scopes,
      tenant: key.client.tenant,
    };

    const required = this.reflector.getAllAndOverride<Scope[] | undefined>(SCOPES_META, targets) ?? [];
    const missing = required.filter((s) => !key.scopes.includes(s));
    if (missing.length > 0) {
      await this.deny(ctx, 'missing_scope', key.prefix, { missing });
      throw new DomainError(ErrorCode.FORBIDDEN, `This API key lacks the scope(s): ${missing.join(', ')}.`);
    }
    return true;
  }

  private deny(
    ctx: ReturnType<typeof getRequestContext>,
    reason: string,
    prefix?: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    return this.audit.record({
      ...AuditService.fromContext(ctx),
      actorType: 'api_client',
      apiKeyPrefix: prefix ?? null,
      action: 'auth.denied',
      outcome: 'denied',
      metadata: { layer: 'api_key', reason, ...extra },
    });
  }
}
