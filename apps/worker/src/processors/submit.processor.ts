import { Inject, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { APP_ENV, BookingFailureCode, decryptJson, Env, QUEUES, SubmitJobData } from '@app/common';
import { PrismaService } from '@app/database';
import { AuditService } from '@app/audit';
import { ErrorLogService } from '@app/logging';
import type { Contact } from '@app/contact';
import { BookingResult, PlatformRouter } from '@app/providers';
import { BookingFailure, ReservationWebhookService } from '@app/webhooks';
import { RepairTriggerService } from '../repair/repair-trigger.service';
import { decideSubmit, LOGGED_FAILURES } from './submit-policy';

class RetryBooking extends Error {}

const concurrency = Number(process.env.SUBMIT_CONCURRENCY ?? 2) || 2;

/**
 * Runs bookings (DESIGN.md §4.2 step 3). Never asks a user to act: every job ends confirmed or
 * failed, and either way the reservation status webhook fires.
 */
@Processor(QUEUES.SUBMIT, { concurrency })
export class SubmitProcessor extends WorkerHost {
  private readonly logger = new Logger(SubmitProcessor.name);

  constructor(
    @Inject(APP_ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly router: PlatformRouter,
    private readonly audit: AuditService,
    private readonly errorLog: ErrorLogService,
    private readonly statusWebhook: ReservationWebhookService,
    private readonly repair: RepairTriggerService,
  ) {
    super();
  }

  async process(job: Job<SubmitJobData>): Promise<void> {
    const { reservationId, requestId } = job.data;
    const reservation = await this.prisma.reservation.findUnique({ where: { id: reservationId } });
    if (!reservation || reservation.status !== 'pending') return; // already final

    // A previous attempt started but never finished (worker crash). The confirm click may have
    // happened, so never retry: report it for a person to check with the venue.
    if (reservation.inFlight) {
      await this.fail(reservationId, requestId, {
        errorCode: BookingFailureCode.OUTCOME_UNKNOWN,
        message: 'A previous booking attempt was interrupted; the booking may or may not exist.',
        submitted: true,
      });
      return;
    }

    const attempt = job.attemptsMade + 1;
    await this.prisma.reservation.update({
      where: { id: reservationId },
      data: { inFlight: true, bookingAttempts: { increment: 1 } },
    });

    const request = {
      reservationId,
      restaurantId: reservation.restaurantId,
      venueId: reservation.venueId,
      date: reservation.localDate,
      time: reservation.localTime,
      partySize: reservation.partySize,
      notes: reservation.notes,
    };

    let result: BookingResult;
    try {
      const contact = decryptJson<Contact>(this.env.JOB_ENCRYPTION_KEY, job.data.encryptedContact);
      result = await this.router.get(reservation.platform).submit(request, contact, { requestId });
    } catch (err) {
      // Providers must return OUTCOME_UNKNOWN themselves once they have clicked confirm;
      // a thrown error means the script broke before that point.
      this.logger.error({ err, reservationId, requestId }, 'provider submit threw');
      result = {
        status: 'failed',
        errorCode: BookingFailureCode.SCRIPT_FAILED,
        message: 'The booking script stopped with an error before submitting.',
        submitted: false,
        retryable: false,
      };
    }

    const decision = decideSubmit(result, request, attempt, this.env.MAX_BOOKING_ATTEMPTS);

    if (decision.kind === 'confirmed') {
      // Status change + webhook outbox row in one transaction (DESIGN.md §4.5).
      const eventId = await this.statusWebhook.confirmReservation(reservationId, decision.confirmationCode);
      if (!eventId) return;
      await this.audit.record({
        actorType: 'system',
        actorId: 'submit-worker',
        action: 'reservation.confirmed',
        resourceType: 'reservation',
        resourceId: reservationId,
        outcome: 'success',
        requestId,
        metadata: { attempt, platform: reservation.platform, event_id: eventId },
      });
      return;
    }

    if (decision.kind === 'retry') {
      await this.prisma.reservation.update({ where: { id: reservationId }, data: { inFlight: false } });
      await this.audit.record({
        actorType: 'system',
        actorId: 'submit-worker',
        action: 'reservation.retried',
        resourceType: 'reservation',
        resourceId: reservationId,
        outcome: 'failure',
        requestId,
        metadata: { attempt, reason: decision.reason },
      });
      throw new RetryBooking(decision.reason); // BullMQ schedules the next attempt with backoff
    }

    await this.fail(reservationId, requestId, decision.failure);
  }

  /** Last-resort safety net: an unexpected error used up every attempt. */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<SubmitJobData> | undefined, err: Error): Promise<void> {
    if (!job || err instanceof RetryBooking) return;
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) return;
    this.logger.error({ err, reservationId: job.data.reservationId }, 'submit job exhausted its attempts');
    await this.fail(job.data.reservationId, job.data.requestId, {
      errorCode: BookingFailureCode.INTERNAL_ERROR,
      message: 'The booking could not be processed.',
      submitted: false,
    }).catch((e) => this.logger.error({ err: e }, 'could not mark reservation failed'));
  }

  private async fail(reservationId: string, requestId: string, failure: BookingFailure): Promise<void> {
    const eventId = await this.statusWebhook.failReservation(reservationId, failure);
    if (!eventId) return;

    // A script failure starts the self-healing loop straight away (DESIGN.md §7.5).
    const failed = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { platform: true, venueId: true },
    });
    if (failed) {
      await this.repair.onScriptFailure(failed.platform, 'submit', {
        errorCode: failure.errorCode,
        message: failure.message,
        requestId,
        reservationId,
        venueId: failed.venueId,
      });
    }
    await this.audit.record({
      actorType: 'system',
      actorId: 'submit-worker',
      action: 'reservation.failed',
      resourceType: 'reservation',
      resourceId: reservationId,
      outcome: 'failure',
      requestId,
      metadata: { error_code: failure.errorCode, submitted: failure.submitted, event_id: eventId },
    });
    if (LOGGED_FAILURES.has(failure.errorCode)) {
      await this.errorLog.record({
        source: 'worker',
        severity: failure.errorCode === BookingFailureCode.OUTCOME_UNKNOWN ? 'critical' : 'error',
        errorCode: failure.errorCode,
        message: failure.message,
        requestId,
        reservationId,
        context: { event_id: eventId, submitted: failure.submitted },
      });
    }
  }
}
