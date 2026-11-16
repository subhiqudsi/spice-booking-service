import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '@app/database';
import { ReservationWebhookService } from '@app/webhooks';

const STUCK_AFTER_MS = 5 * 60_000;

/**
 * Re-queues outbox rows that never reached the queue or whose job was lost (DESIGN.md §4.5).
 * Re-adding uses the same job id, so a job that still exists is not duplicated.
 */
@Injectable()
export class WebhookSweeper {
  private readonly logger = new Logger(WebhookSweeper.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly statusWebhook: ReservationWebhookService,
  ) {}

  @Interval(60_000)
  async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const stuck = await this.prisma.webhookDelivery.findMany({
        where: { status: 'pending', nextAttemptAt: { lt: new Date(Date.now() - STUCK_AFTER_MS) } },
        orderBy: { nextAttemptAt: 'asc' },
        take: 100,
      });
      for (const row of stuck) {
        const jobId = row.replays > 0 ? `${row.eventId}-r${row.replays}` : row.eventId;
        await this.statusWebhook.enqueue(row.eventId, jobId);
      }
      if (stuck.length) this.logger.warn({ count: stuck.length }, 're-queued stuck status webhooks');
      return stuck.length;
    } finally {
      this.running = false;
    }
  }
}
