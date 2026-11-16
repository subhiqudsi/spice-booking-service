import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_ENV, Env } from '@app/common';
import { PrismaService } from '@app/database';
import { AuditService } from '@app/audit';
import { ErrorLogService } from '@app/logging';
import { backoffMs, decideDelivery } from './delivery-policy';
import { signWebhook } from './webhook-signer';

/** Thrown to make BullMQ schedule the next attempt with its backoff. */
export class RetryWebhookLater extends Error {
  constructor(eventId: string, reason: string) {
    super(`webhook ${eventId} will be retried: ${reason}`);
    this.name = 'RetryWebhookLater';
  }
}

/** Makes one delivery attempt for an outbox row and records the result. */
@Injectable()
export class WebhookSenderService {
  private readonly logger = new Logger(WebhookSenderService.name);

  constructor(
    @Inject(APP_ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly errorLog: ErrorLogService,
  ) {}

  async deliver(eventId: string): Promise<'delivered' | 'dead' | 'skipped'> {
    const row = await this.prisma.webhookDelivery.findUnique({ where: { eventId } });
    if (!row || row.status !== 'pending') return 'skipped';

    const attempt = row.attempts + 1;
    const rawBody = JSON.stringify(row.payload);
    const timestamp = Math.floor(Date.now() / 1000);

    let httpStatus: number | null = null;
    let error: string | null = null;
    try {
      const res = await fetch(this.env.RESERVATION_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-booking-event-id': eventId,
          'x-booking-timestamp': String(timestamp),
          'x-booking-signature': signWebhook(this.env.RESERVATION_WEBHOOK_SECRET, timestamp, rawBody),
        },
        body: rawBody,
        signal: AbortSignal.timeout(this.env.RESERVATION_WEBHOOK_TIMEOUT_MS),
        redirect: 'manual',
      });
      httpStatus = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
      await res.body?.cancel().catch(() => undefined);
    } catch (err) {
      error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }

    const decision = decideDelivery(httpStatus, attempt, this.env.RESERVATION_WEBHOOK_MAX_ATTEMPTS);
    const auditBase = {
      actorType: 'system' as const,
      actorId: 'webhook-sender',
      resourceType: 'webhook_delivery',
      resourceId: eventId,
      requestId: (row.payload as { request_id?: string }).request_id ?? null,
    };

    if (decision === 'delivered') {
      await this.prisma.webhookDelivery.update({
        where: { eventId },
        data: { status: 'delivered', attempts: attempt, lastHttpStatus: httpStatus, lastError: null, deliveredAt: new Date() },
      });
      await this.audit.record({ ...auditBase, action: 'webhook.delivered', outcome: 'success', metadata: { attempt } });
      return 'delivered';
    }

    if (decision === 'dead') {
      await this.prisma.webhookDelivery.update({
        where: { eventId },
        data: { status: 'dead', attempts: attempt, lastHttpStatus: httpStatus, lastError: error },
      });
      await this.audit.record({
        ...auditBase,
        action: 'webhook.dead',
        outcome: 'failure',
        metadata: { attempt, http_status: httpStatus, error },
      });
      await this.errorLog.record({
        source: 'webhook',
        severity: 'critical',
        errorCode: 'WEBHOOK_DELIVERY_FAILED',
        message: `Status webhook ${eventId} gave up after ${attempt} attempt(s): ${error ?? 'unknown error'}`,
        requestId: auditBase.requestId ?? undefined,
        reservationId: row.reservationId,
        context: { event_id: eventId, http_status: httpStatus, attempts: attempt },
      });
      this.logger.error({ eventId, attempt, httpStatus, error }, 'status webhook is dead');
      return 'dead';
    }

    await this.prisma.webhookDelivery.update({
      where: { eventId },
      data: {
        attempts: attempt,
        lastHttpStatus: httpStatus,
        lastError: error,
        nextAttemptAt: new Date(Date.now() + backoffMs(attempt)),
      },
    });
    await this.audit.record({
      ...auditBase,
      action: 'webhook.retry_scheduled',
      outcome: 'failure',
      metadata: { attempt, http_status: httpStatus, error },
    });
    throw new RetryWebhookLater(eventId, error ?? 'unknown error');
  }
}
