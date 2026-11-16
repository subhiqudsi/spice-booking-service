import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUES } from '@app/common';
import { ReservationWebhookService } from './reservation-webhook.service';
import { WebhookSenderService } from './webhook-sender.service';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.RESERVATION_WEBHOOK })],
  providers: [ReservationWebhookService, WebhookSenderService],
  exports: [ReservationWebhookService, WebhookSenderService],
})
export class WebhooksModule {}

export { ReservationWebhookService, buildReservationPayload } from './reservation-webhook.service';
export type { BookingFailure, ReservationEventPayload, ReservationEventType } from './reservation-webhook.service';
export { WebhookSenderService, RetryWebhookLater } from './webhook-sender.service';
export { signWebhook, verifyWebhook } from './webhook-signer';
export { decideDelivery, backoffMs } from './delivery-policy';
