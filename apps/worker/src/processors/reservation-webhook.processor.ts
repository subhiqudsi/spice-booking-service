import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUES, ReservationWebhookJobData } from '@app/common';
import { WebhookSenderService } from '@app/webhooks';

/**
 * Delivers reservation status events (confirmed and failed). A retryable failure throws
 * RetryWebhookLater, and BullMQ waits 30 s, 1, 2, 4… min before the next attempt; the sender
 * marks the event dead on the last one.
 */
@Processor(QUEUES.RESERVATION_WEBHOOK, { concurrency: 5 })
export class ReservationWebhookProcessor extends WorkerHost {
  constructor(private readonly sender: WebhookSenderService) {
    super();
  }

  async process(job: Job<ReservationWebhookJobData>): Promise<string> {
    return this.sender.deliver(job.data.eventId);
  }
}
