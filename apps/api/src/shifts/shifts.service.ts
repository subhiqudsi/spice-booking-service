import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import {
  APP_ENV,
  DomainError,
  Env,
  ErrorCode,
  QUEUES,
  REDIS,
  RequestContext,
  ShiftsJobData,
  signSlotToken,
} from '@app/common';
import type { Shift } from '@app/providers';
import { VenueResolver } from '../venues/venue-resolver.service';

export interface ShiftsResponse {
  restaurant_id: string;
  date: string;
  party_size: number;
  platform: string;
  shifts: Array<{
    shift_id: string;
    name: string;
    slots: Array<{ time: string; slot_token: string; available: true }>;
  }>;
  fetched_at: string;
  cache_ttl_s: number;
}

const SLOT_TOKEN_TTL_S = 30 * 60;

/**
 * Shift times. Browser work happens in the worker, so this queues a `shifts` job and waits for its
 * result, with a short Redis cache in front (DESIGN.md §4.1).
 */
@Injectable()
export class ShiftsService implements OnModuleDestroy {
  private readonly logger = new Logger(ShiftsService.name);
  private queueEvents?: QueueEvents;

  constructor(
    @Inject(APP_ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
    @InjectQueue(QUEUES.SHIFTS) private readonly queue: Queue<ShiftsJobData, Shift[]>,
    private readonly venues: VenueResolver,
  ) {}

  async getShifts(restaurantId: string, date: string, partySize: number, ctx: RequestContext): Promise<ShiftsResponse> {
    const { restaurant, mapping } = await this.venues.resolve(restaurantId, partySize);

    const cacheKey = `shifts:${mapping.platform}:${mapping.venueId}:${date}:${partySize}`;
    const cached = await this.redis.get(cacheKey).catch(() => null);
    let shifts: Shift[];
    let fetchedAt: string;

    if (cached) {
      ({ shifts, fetchedAt } = JSON.parse(cached) as { shifts: Shift[]; fetchedAt: string });
    } else {
      shifts = await this.fetchFromWorker({
        requestId: ctx.requestId,
        platform: mapping.platform,
        venueId: mapping.venueId,
        date,
        partySize,
      });
      fetchedAt = new Date().toISOString();
      if (this.env.SHIFTS_CACHE_TTL_S > 0) {
        await this.redis
          .set(cacheKey, JSON.stringify({ shifts, fetchedAt }), 'EX', this.env.SHIFTS_CACHE_TTL_S)
          .catch((err) => this.logger.warn({ err }, 'shift cache write failed'));
      }
    }

    const exp = Math.floor(Date.now() / 1000) + SLOT_TOKEN_TTL_S;
    return {
      restaurant_id: restaurant.id,
      date,
      party_size: partySize,
      platform: mapping.platform,
      shifts: shifts.map((shift) => ({
        shift_id: shift.shiftId,
        name: shift.name,
        slots: shift.slots
          .filter((slot) => slot.available)
          .map((slot) => ({
            time: slot.time,
            available: true as const,
            slot_token: signSlotToken(this.env.SLOT_TOKEN_SECRET, {
              r: restaurant.id,
              p: mapping.platform,
              v: mapping.venueId,
              d: date,
              t: slot.time,
              s: shift.shiftId,
              n: partySize,
              exp,
            }),
          })),
      })),
      fetched_at: fetchedAt,
      cache_ttl_s: this.env.SHIFTS_CACHE_TTL_S,
    };
  }

  private async fetchFromWorker(data: ShiftsJobData): Promise<Shift[]> {
    const job = await this.queue.add('get-shifts', data, { attempts: 1, removeOnComplete: 100, removeOnFail: 100 });
    try {
      return await job.waitUntilFinished(this.events(), this.env.SHIFTS_TIMEOUT_MS);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new DomainError(ErrorCode.PLATFORM_UNAVAILABLE, 'Shift times could not be loaded from the platform.', [], {
        reason: message,
        platform: data.platform,
      });
    }
  }

  private events(): QueueEvents {
    if (!this.queueEvents) {
      this.queueEvents = new QueueEvents(QUEUES.SHIFTS, {
        connection: new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null }),
      });
    }
    return this.queueEvents;
  }

  async onModuleDestroy(): Promise<void> {
    await this.queueEvents?.close();
  }
}
