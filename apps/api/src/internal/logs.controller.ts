import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PrismaService } from '@app/database';
import { Audit } from '@app/audit';
import { ReservationWebhookService } from '@app/webhooks';
import { Scopes } from '../auth/decorators';
import { AuditLogQuery, ErrorLogQuery, WebhookDeliveryQuery } from './internal.dto';

function range(from?: string, to?: string) {
  return from || to ? { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } : undefined;
}

@Controller('internal')
@Scopes('admin')
export class LogsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly statusWebhook: ReservationWebhookService,
  ) {}

  @Get('audit-logs')
  auditLogs(@Query() q: AuditLogQuery) {
    return this.prisma.auditLog.findMany({
      where: {
        actorId: q.actor,
        action: q.action,
        resourceType: q.resource_type,
        resourceId: q.resource_id,
        occurredAt: range(q.from, q.to),
      },
      orderBy: { occurredAt: 'desc' },
      take: q.limit ?? 100,
    });
  }

  @Get('error-logs')
  errorLogs(@Query() q: ErrorLogQuery) {
    return this.prisma.errorLog.findMany({
      where: { source: q.source, errorCode: q.code, fingerprint: q.fingerprint, occurredAt: range(q.from, q.to) },
      orderBy: { occurredAt: 'desc' },
      take: q.limit ?? 100,
    });
  }

  @Get('webhook-deliveries')
  webhookDeliveries(@Query() q: WebhookDeliveryQuery) {
    return this.prisma.webhookDelivery.findMany({
      where: { status: q.status },
      orderBy: { createdAt: 'desc' },
      take: q.limit ?? 100,
    });
  }

  @Post('webhook-deliveries/:eventId/replay')
  @Audit('webhook.replayed', { resourceType: 'webhook_delivery', resourceId: (_res, params) => params.eventId })
  replay(@Param('eventId') eventId: string) {
    return this.statusWebhook.replay(eventId);
  }
}
