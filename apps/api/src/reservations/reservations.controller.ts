import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DomainError, ErrorCode, getRequestContext, getServiceToken } from '@app/common';
import { Audit } from '@app/audit';
import { Scopes } from '../auth/decorators';
import { CreateReservationDto, ListReservationsQuery } from './reservations.dto';
import { ReservationList, ReservationsService, ReservationView } from './reservations.service';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

@Controller('v1/reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Post()
  @HttpCode(202)
  @Scopes('reservations:write')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Audit('reservation.created', {
    resourceType: 'reservation',
    resourceId: (res) => (res as ReservationView | undefined)?.reservation_id,
  })
  async create(
    @Body() dto: CreateReservationDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ReservationView> {
    if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw new DomainError(ErrorCode.VALIDATION_ERROR, 'An Idempotency-Key header (8-128 chars: letters, digits, - or _) is required.', [
        { field: 'Idempotency-Key', issue: 'missing or malformed' },
      ]);
    }
    const token = getServiceToken(req);
    if (!token) throw new DomainError(ErrorCode.SERVICE_AUTH_REQUIRED, 'A service token is required.');

    const { view, replay } = await this.reservations.create(dto, idempotencyKey, token, getRequestContext(req));
    if (replay) void reply.header('idempotent-replay', 'true');
    return view;
  }

  /** GET /v1/reservations?filter=upcoming|previous|all&status=&limit=&cursor= */
  @Get()
  @Scopes('reservations:read')
  list(@Query() query: ListReservationsQuery, @Req() req: FastifyRequest): Promise<ReservationList> {
    return this.reservations.list(query, getRequestContext(req));
  }

  @Get(':id')
  @Scopes('reservations:read')
  get(@Param('id') id: string, @Req() req: FastifyRequest): Promise<ReservationView> {
    return this.reservations.get(id, getRequestContext(req));
  }
}
