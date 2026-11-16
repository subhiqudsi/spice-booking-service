import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { getRequestContext } from '@app/common';
import type { FastifyRequest } from 'fastify';

/** Rate limits per API key (falls back to IP before the key is known). */
@Injectable()
export class ApiKeyThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const ctx = getRequestContext(req as unknown as FastifyRequest);
    return ctx.apiClient?.keyPrefix ?? ctx.ip ?? 'unknown';
  }
}
