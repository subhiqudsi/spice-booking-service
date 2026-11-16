import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { DomainError, ErrorCode } from '@app/common';
import { isUniqueViolation, PrismaService } from '@app/database';
import { Audit } from '@app/audit';
import { Scopes } from '../auth/decorators';
import { CreateVenueMappingDto, ListQuery, UpdateVenueMappingDto } from './internal.dto';

class MappingListQuery extends ListQuery {
  @IsOptional() @IsIn(['proposed', 'verified', 'rejected', 'stale']) status?: 'proposed' | 'verified' | 'rejected' | 'stale';
}

/** Review queue for venue mappings. Bookings only use `verified` mappings. */
@Controller('internal/venue-mappings')
@Scopes('admin')
export class VenueMappingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Query() query: MappingListQuery) {
    return this.prisma.venueMapping.findMany({
      where: { status: query.status },
      orderBy: { updatedAt: 'desc' },
      take: query.limit ?? 50,
    });
  }

  @Post()
  @Audit('venue_mapping.created', { resourceType: 'venue_mapping', resourceId: (res) => (res as { id?: string })?.id })
  async create(@Body() dto: CreateVenueMappingDto) {
    const restaurant = await this.prisma.restaurant.findUnique({ where: { id: dto.restaurant_id } });
    if (!restaurant) throw new DomainError(ErrorCode.RESTAURANT_NOT_FOUND, `Restaurant ${dto.restaurant_id} was not found.`);
    const status = dto.status ?? 'verified';
    try {
      return await this.prisma.venueMapping.create({
        data: {
          restaurantId: dto.restaurant_id,
          platform: dto.platform,
          venueId: dto.venue_id,
          venueUrl: dto.venue_url,
          status,
          source: 'human',
          confidence: 1,
          verifiedAt: status === 'verified' ? new Date() : null,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DomainError(ErrorCode.VALIDATION_ERROR, `Restaurant ${dto.restaurant_id} already has a ${dto.platform} mapping.`, [
          { field: 'platform', issue: 'mapping already exists; update it instead' },
        ]);
      }
      throw err;
    }
  }

  @Patch(':id')
  @Audit('venue_mapping.updated', { resourceType: 'venue_mapping' })
  async update(@Param('id') id: string, @Body() dto: UpdateVenueMappingDto) {
    const existing = await this.prisma.venueMapping.findUnique({ where: { id } });
    if (!existing) throw new DomainError(ErrorCode.NOT_FOUND, `Venue mapping ${id} was not found.`);
    return this.prisma.venueMapping.update({
      where: { id },
      data: {
        status: dto.status,
        venueId: dto.venue_id,
        venueUrl: dto.venue_url,
        bookable: dto.bookable,
        source: 'human',
        verifiedAt: dto.status === 'verified' ? new Date() : undefined,
      },
    });
  }
}
