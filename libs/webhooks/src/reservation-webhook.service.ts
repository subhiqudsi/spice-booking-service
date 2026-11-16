import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma, Reservation } from '@prisma/client';
import { Queue } from 'bullmq';
import { ulid } from 'ulid';
import {
  APP_ENV,
  BookingFailureCode,
  DomainError,
  Env,
  ErrorCode,
  QUEUES,
  ReservationWebhookJobData,
} from '@app/common';
import { PrismaService } from '@app/database';
import { WEBHOOK_BASE_BACKOFF_MS } from './delivery-policy';

export interface BookingFailure {
  errorCode: BookingFailureCode;
  /** Safe to send outside: no contact details, tokens or internals. */
  message: string;
  submitted: boolean;
  scriptVersion?: string | null;
}

export type ReservationEventType = 'reservation.confirmed' | 'reservation.failed';

/**
 * Body of every reservation status event (DESIGN.md §4.5). One shape for both event types:
 * `platform_confirmation_code` is set when confirmed, `error_*` when failed, the rest is null.
 */
export interface ReservationEventPayload {
  event_id: string;
  type: ReservationEventType;
  occurred_at: string;
  reservation_id: string;
  status: 'confirmed' | 'failed';
  restaurant_id: string;
  platform: string;
  venue_id: string;
  datetime: string;
  party_size: number;
  platform_confirmation_code: string | null;
  error_code: BookingFailureCode | null;
  error_message: string | null;
  submitted: boolean;
  booking_attempts: number;
  script_version: string | null;
  api_client_id: string;
  request_id: string;
}

export function buildReservationPayload(
  eventId: string,
  reservation: Reservation,
  occurredAt: Date,
  scriptVersion: string | null = null,
): ReservationEventPayload {
  if (reservation.status === 'pending') throw new Error('Status events are only sent for final states');
  return {
    event_id: eventId,
    type: reservation.status === 'confirmed' ? 'reservation.confirmed' : 'reservation.failed',
    occurred_at: occurredAt.toISOString(),
    reservation_id: reservation.id,
    status: reservation.status,
    restaurant_id: reservation.restaurantId,
    platform: reservation.platform,
    venue_id: reservation.venueId,
    datetime: reservation.datetime.toISOString(),
    party_size: reservation.partySize,
    platform_confirmation_code: reservation.platformConfirmationCode,
    error_code: (reservation.errorCode as BookingFailureCode | null) ?? null,
    error_message: reservation.errorDetail,
    submitted: reservation.submitted,
    booking_attempts: reservation.bookingAttempts,
    script_version: scriptVersion,
    api_client_id: reservation.apiClientId,
    request_id: reservation.requestId,
  };
}

type FinalUpdate = Pick<
  Prisma.ReservationUpdateManyMutationInput,
  'status' | 'platformConfirmationCode' | 'errorCode' | 'errorDetail' | 'submitted'
>;

/**
 * Moves a reservation to its final status and queues the status webhook. The status change and
 * the outbox row are written in one transaction, so an event is never lost even if Redis is down;
 * the sweeper picks up anything that didn't reach the queue.
 */
@Injectable()
export class ReservationWebhookService {
  private readonly logger = new Logger(ReservationWebhookService.name);

  constructor(
    @Inject(APP_ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.RESERVATION_WEBHOOK) private readonly queue: Queue<ReservationWebhookJobData>,
  ) {}

  /** Returns the event id, or null if the reservation was already final. */
  confirmReservation(reservationId: string, confirmationCode: string, scriptVersion?: string | null) {
    return this.finalize(
      reservationId,
      {
        status: 'confirmed',
        platformConfirmationCode: confirmationCode,
        submitted: true,
        errorCode: null,
        errorDetail: null,
      },
      scriptVersion ?? null,
    );
  }

  /** Returns the event id, or null if the reservation was already final. */
  failReservation(reservationId: string, failure: BookingFailure) {
    return this.finalize(
      reservationId,
      {
        status: 'failed',
        errorCode: failure.errorCode,
        errorDetail: failure.message,
        submitted: failure.submitted,
      },
      failure.scriptVersion ?? null,
    );
  }

  private async finalize(reservationId: string, update: FinalUpdate, scriptVersion: string | null): Promise<string | null> {
    const eventId = `evt_${ulid()}`;
    const now = new Date();

    const created = await this.prisma.$transaction(async (tx) => {
      // Only a pending reservation can change, so each reservation sends exactly one status event.
      const updated = await tx.reservation.updateMany({
        where: { id: reservationId, status: 'pending' },
        data: { ...update, inFlight: false },
      });
      if (updated.count === 0) return false;

      const reservation = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId } });
      const payload = buildReservationPayload(eventId, reservation, now, scriptVersion);
      await tx.webhookDelivery.create({
        data: {
          eventId,
          eventType: payload.type,
          reservationId,
          payload: payload as unknown as Prisma.InputJsonValue,
          nextAttemptAt: now,
        },
      });
      return true;
    });

    if (!created) return null;
    await this.enqueue(eventId, eventId);
    return eventId;
  }

  /** Puts a delivery job on the queue. Failure here is logged, not thrown: the sweeper retries it. */
  async enqueue(eventId: string, jobId: string): Promise<void> {
    try {
      await this.queue.add(
        'deliver',
        { eventId },
        {
          jobId,
          attempts: this.env.RESERVATION_WEBHOOK_MAX_ATTEMPTS,
          backoff: { type: 'exponential', delay: WEBHOOK_BASE_BACKOFF_MS },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (err) {
      this.logger.warn({ err, eventId }, 'status webhook enqueue failed; sweeper will retry');
    }
  }

  /** Sends a dead (or stuck) event again from the admin API. */
  async replay(eventId: string): Promise<{ eventId: string; replays: number }> {
    const row = await this.prisma.webhookDelivery.findUnique({ where: { eventId } });
    if (!row) throw new DomainError(ErrorCode.NOT_FOUND, `Webhook event ${eventId} not found.`);
    if (row.status === 'delivered') {
      throw new DomainError(ErrorCode.VALIDATION_ERROR, 'This event was already delivered.', [
        { field: 'eventId', issue: 'already delivered' },
      ]);
    }
    const updated = await this.prisma.webhookDelivery.update({
      where: { eventId },
      data: { status: 'pending', attempts: 0, replays: { increment: 1 }, nextAttemptAt: new Date(), lastError: null },
    });
    await this.enqueue(eventId, `${eventId}-r${updated.replays}`);
    return { eventId, replays: updated.replays };
  }
}
