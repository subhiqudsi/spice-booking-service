import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { getRequestContext } from '@app/common';
import { Scopes } from '../auth/decorators';
import { GetShiftsQuery } from './shifts.dto';
import { ShiftsResponse, ShiftsService } from './shifts.service';

@Controller('v1/restaurants')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get(':restaurantId/shifts')
  @Scopes('shifts:read')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  getShifts(
    @Param('restaurantId') restaurantId: string,
    @Query() query: GetShiftsQuery,
    @Req() req: FastifyRequest,
  ): Promise<ShiftsResponse> {
    return this.shifts.getShifts(restaurantId, query.date, query.party_size, getRequestContext(req));
  }
}
