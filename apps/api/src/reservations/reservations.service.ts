import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma, Reservation } from '@prisma/client';
import { Queue } from 'bullmq';
import { ulid } from 'ulid';
import {
  APP_ENV,
  BookingFailureCode,
  DomainError,
  encryptJson,
  Env,
  ErrorCode,
  QUEUES,
  RequestContext,
  sha256Hex,
  stableStringify,
  SubmitJobData,
  toVenueLocal,
  verifySlotToken,
} from '@app/common';
import { isUniqueViolation, PrismaService } from '@app/database';
import { AuditService } from '@app/audit';
import { ContactClient } from '@app/contact';
import { ReservationWebhookService } from '@app/webhooks';
import { VenueResolver } from '../venues/venue-resolver.service';
import { CreateReservationDto, ListReservationsQuery } from './reservations.dto';

export interface ReservationList {
  filter: 'upcoming' | 'previous' | 'all';
  data: ReservationView[];
  next_cursor: string | null;
}

export interface ReservationView {
  reservation_id: string;
  status: Reservation['status'];
  restaurant_id: string;
  datetime: string;
  party_size: number;
  platform_confirmation_code?: string;
  error_code?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export function toView(r: Reservation): ReservationView {
  return {
    reservation_id: r.id,
    status: r.status,
    restaurant_id: r.restaurantId,
    datetime: r.datetime.toISOString(),
    party_size: r.partySize,
    ...(r.platformConfirmationCode ? { platform_confirmation_code: r.platformConfirmationCode } : {}),
    ...(r.errorCode ? { error_code: r.errorCode, error_message: r.errorDetail ?? undefined } : {}),
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

/**
 * Submit reservation flow (DESIGN.md §4.2). Responds 202; the worker finishes the booking and the
 * final status (confirmed or failed) is pushed through the reservation status webhook.
 */
@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    @Inject(APP_ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly venues: VenueResolver,
    private readonly contacts: ContactClient,
    private readonly audit: AuditService,
    private readonly statusWebhook: ReservationWebhookService,
    @InjectQueue(QUEUES.SUBMIT) private readonly submitQueue: Queue<SubmitJobData>,
  ) {}

  async create(
    dto: CreateReservationDto,
    idempotencyKey: string,
    serviceToken: string,
    ctx: RequestContext,
  ): Promise<{ view: ReservationView; replay: boolean }> {
    const apiClientId = ctx.apiClient!.clientId;
    const requestHash = sha256Hex(stableStringify(dto));

    // 1. Idempotency: same key + same body returns the original; same key + different body is a conflict.
    const existing = await this.findByIdempotencyKey(apiClientId, idempotencyKey);
    if (existing) return this.replay(existing, requestHash, ctx);

    // 2. Venue and request checks.
    const { restaurant, mapping } = await this.venues.resolve(dto.restaurant_id, dto.party_size);
    const instant = new Date(dto.datetime);
    const local = toVenueLocal(instant, restaurant.timezone);
    if (dto.slot_token) {
      const slot = verifySlotToken(this.env.SLOT_TOKEN_SECRET, dto.slot_token);
      const mismatch =
        slot.r !== restaurant.id ? 'restaurant' :
        slot.v !== mapping.venueId || slot.p !== mapping.platform ? 'venue' :
        slot.n !== dto.party_size ? 'party_size' :
        slot.d !== local.date || slot.t !== local.time ? 'datetime' : null;
      if (mismatch) {
        throw new DomainError(ErrorCode.INVALID_SLOT_TOKEN, `slot_token does not match the request's ${mismatch}.`, [
          { field: 'slot_token', issue: `${mismatch} mismatch` },
        ]);
      }
    }

    // 3. Contact details, fetched inside the request so the JWT never reaches the queue.
    const contact = await this.contacts.getContact(serviceToken, ctx.requestId);

    // 4. Persist, then queue the booking.
    let reservation: Reservation;
    try {
      reservation = await this.prisma.reservation.create({
        data: {
          id: `res_${ulid()}`,
          apiClientId,
          userRef: ctx.principal!.userRef,
          idempotencyKey,
          requestHash,
          restaurantId: restaurant.id,
          platform: mapping.platform,
          venueId: mapping.venueId,
          datetime: instant,
          localDate: local.date,
          localTime: local.time,
          partySize: dto.party_size,
          notes: dto.notes ?? null,
          requestId: ctx.requestId,
        },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // A concurrent request with the same Idempotency-Key won the race.
      const raced = await this.findByIdempotencyKey(apiClientId, idempotencyKey);
      if (!raced) throw err;
      return this.replay(raced, requestHash, ctx);
    }

    try {
      await this.submitQueue.add(
        'submit',
        {
          requestId: ctx.requestId,
          reservationId: reservation.id,
          encryptedContact: encryptJson(this.env.JOB_ENCRYPTION_KEY, contact),
        },
        {
          jobId: reservation.id,
          attempts: this.env.MAX_BOOKING_ATTEMPTS,
          backoff: { type: 'exponential', delay: 5_000 },
        },
      );
    } catch (err) {
      this.logger.error({ err, reservationId: reservation.id }, 'submit enqueue failed');
      await this.statusWebhook.failReservation(reservation.id, {
        errorCode: BookingFailureCode.INTERNAL_ERROR,
        message: 'The booking could not be queued.',
        submitted: false,
      });
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 'The booking could not be queued.', [], {
        reservationId: reservation.id,
      });
    }

    return { view: toView(reservation), replay: false };
  }

  /** Callers only see their own reservations: same API client and same user (JWT subject). */
  private owner(ctx: RequestContext) {
    return { apiClientId: ctx.apiClient!.clientId, userRef: ctx.principal!.userRef };
  }

  async get(id: string, ctx: RequestContext): Promise<ReservationView> {
    const reservation = await this.prisma.reservation.findFirst({ where: { id, ...this.owner(ctx) } });
    if (!reservation) throw new DomainError(ErrorCode.RESERVATION_NOT_FOUND, `Reservation ${id} was not found.`);
    return toView(reservation);
  }

  /** GET /v1/reservations — the caller's reservations, filtered by upcoming / previous / all. */
  async list(query: ListReservationsQuery, ctx: RequestContext, now = new Date()): Promise<ReservationList> {
    const filter = query.filter ?? 'all';
    const limit = query.limit ?? 20;
    const where: Prisma.ReservationWhereInput = {
      ...this.owner(ctx),
      ...(query.status ? { status: query.status } : {}),
      ...(filter === 'upcoming' ? { datetime: { gte: now } } : filter === 'previous' ? { datetime: { lt: now } } : {}),
    };
    const direction = filter === 'upcoming' ? 'asc' : 'desc';

    if (query.cursor) {
      const anchor = await this.prisma.reservation.findFirst({ where: { ...where, id: query.cursor }, select: { id: true } });
      if (!anchor) {
        throw new DomainError(ErrorCode.VALIDATION_ERROR, 'cursor does not belong to this list.', [
          { field: 'cursor', issue: 'unknown for this filter' },
        ]);
      }
    }

    const rows = await this.prisma.reservation.findMany({
      where,
      orderBy: [{ datetime: direction }, { id: direction }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    return {
      filter,
      data: page.map(toView),
      next_cursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  private findByIdempotencyKey(apiClientId: string, idempotencyKey: string) {
    return this.prisma.reservation.findUnique({
      where: { apiClientId_idempotencyKey: { apiClientId, idempotencyKey } },
    });
  }

  private async replay(existing: Reservation, requestHash: string, ctx: RequestContext) {
    if (existing.requestHash !== requestHash) {
      throw new DomainError(
        ErrorCode.IDEMPOTENCY_CONFLICT,
        'This Idempotency-Key was already used with a different request body.',
        [{ field: 'Idempotency-Key', issue: 'reused with a different body' }],
        { reservationId: existing.id },
      );
    }
    await this.audit.record({
      ...AuditService.fromContext(ctx),
      action: 'reservation.idempotent_replay',
      resourceType: 'reservation',
      resourceId: existing.id,
      outcome: 'success',
    });
    return { view: toView(existing), replay: true };
  }
}
