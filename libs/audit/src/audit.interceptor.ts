import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { Observable, tap } from 'rxjs';
import { DomainError, getRequestContext } from '@app/common';
import { AUDIT_META, AuditMeta } from './audit.decorator';
import { AuditService } from './audit.service';

/** Writes an audit row for every handler marked with @Audit, including failures. */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMeta | undefined>(AUDIT_META, context.getHandler());
    if (!meta) return next.handle();

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const params = (req.params ?? {}) as Record<string, string>;

    const write = (outcome: 'success' | 'failure', response: unknown, error?: unknown) => {
      const ctx = getRequestContext(req);
      void this.audit.record({
        ...AuditService.fromContext(ctx),
        action: meta.action,
        resourceType: meta.resourceType ?? null,
        resourceId: meta.resourceId?.(response, params) ?? params.id ?? null,
        outcome,
        metadata: error
          ? { error_code: error instanceof DomainError ? error.code : 'INTERNAL_ERROR' }
          : null,
      });
    };

    return next.handle().pipe(
      tap({
        next: (response) => write('success', response),
        error: (error: unknown) => write('failure', undefined, error),
      }),
    );
  }
}
