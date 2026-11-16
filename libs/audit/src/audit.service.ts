import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { ulid } from 'ulid';
import { QUEUES, RequestContext } from '@app/common';
import { PrismaService } from '@app/database';
import { ErrorLogService } from '@app/logging';
import { AuditEntry } from './audit.types';

/**
 * Records audit entries. Writes go through a queue so an audit insert never slows a request;
 * if the queue is unavailable it falls back to a direct insert, and if that fails too it raises
 * a critical error log, because losing audit entries isn't acceptable.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectQueue(QUEUES.AUDIT) private readonly queue: Queue<AuditEntry>,
    private readonly prisma: PrismaService,
    private readonly errorLog: ErrorLogService,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    const stamped: AuditEntry = { ...entry, occurredAt: entry.occurredAt ?? new Date().toISOString() };
    try {
      await this.queue.add('write', stamped, { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });
    } catch (queueErr) {
      this.logger.warn({ err: queueErr, action: entry.action }, 'audit queue unavailable, writing directly');
      try {
        await AuditService.insert(this.prisma, stamped);
      } catch (dbErr) {
        this.logger.error({ err: dbErr, action: entry.action }, 'AUDIT_WRITE_FAILED');
        await this.errorLog.record({
          source: 'api',
          severity: 'critical',
          errorCode: 'AUDIT_WRITE_FAILED',
          message: `Audit entry for ${entry.action} could not be written`,
          stack: dbErr instanceof Error ? dbErr.stack : undefined,
          requestId: entry.requestId ?? undefined,
        });
      }
    }
  }

  /** Builds the actor fields from a request context. */
  static fromContext(ctx: RequestContext): Pick<
    AuditEntry,
    'actorType' | 'actorId' | 'apiKeyPrefix' | 'userRef' | 'tokenIssuer' | 'requestId' | 'ip' | 'userAgent'
  > {
    return {
      actorType: ctx.apiClient?.scopes.includes('admin') ? 'admin' : 'api_client',
      actorId: ctx.apiClient?.clientId ?? null,
      apiKeyPrefix: ctx.apiClient?.keyPrefix ?? null,
      userRef: ctx.principal?.userRef ?? null,
      tokenIssuer: ctx.principal?.issuer ?? null,
      requestId: ctx.requestId,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    };
  }

  /** The single place rows are inserted (used by the worker's audit writer and the fallback). */
  static async insert(prisma: PrismaService, entry: AuditEntry): Promise<void> {
    await prisma.auditLog.create({
      data: {
        id: ulid(),
        occurredAt: new Date(entry.occurredAt ?? Date.now()),
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        apiKeyPrefix: entry.apiKeyPrefix ?? null,
        userRef: entry.userRef ?? null,
        tokenIssuer: entry.tokenIssuer ?? null,
        action: entry.action,
        resourceType: entry.resourceType ?? null,
        resourceId: entry.resourceId ?? null,
        outcome: entry.outcome,
        requestId: entry.requestId ?? null,
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
        changes: (entry.changes ?? undefined) as Prisma.InputJsonValue | undefined,
        metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
