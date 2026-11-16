import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { DomainError, ErrorCode } from '@app/common';
import { isUniqueViolation, PrismaService } from '@app/database';
import { Audit } from '@app/audit';
import { Scopes } from '../auth/decorators';
import { CreateRestaurantDto, ListQuery, UpdateRestaurantDto } from './internal.dto';

/** Restaurants are kept by hand during the pilot (source=manual); the Spice sync comes later. */
@Controller('internal/restaurants')
@Scopes('admin')
export class RestaurantsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Query() query: ListQuery) {
    return this.prisma.restaurant.findMany({
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 50,
      include: { venueMappings: true },
    });
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const restaurant = await this.prisma.restaurant.findUnique({ where: { id }, include: { venueMappings: true } });
    if (!restaurant) throw new DomainError(ErrorCode.RESTAURANT_NOT_FOUND, `Restaurant ${id} was not found.`);
    return restaurant;
  }

  @Post()
  @Audit('restaurant.created', { resourceType: 'restaurant', resourceId: (res) => (res as { id?: string })?.id })
  async create(@Body() dto: CreateRestaurantDto) {
    try {
      return await this.prisma.restaurant.create({
        data: {
          id: dto.id,
          name: dto.name,
          address: dto.address,
          city: dto.city,
          phone: dto.phone,
          website: dto.website,
          lat: dto.lat,
          lng: dto.lng,
          timezone: dto.timezone,
          maxPartySize: dto.max_party_size ?? 20,
          source: 'manual',
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DomainError(ErrorCode.VALIDATION_ERROR, `Restaurant ${dto.id} already exists.`, [
          { field: 'id', issue: 'already exists' },
        ]);
      }
      throw err;
    }
  }

  @Patch(':id')
  @Audit('restaurant.updated', { resourceType: 'restaurant' })
  async update(@Param('id') id: string, @Body() dto: UpdateRestaurantDto) {
    await this.get(id);
    return this.prisma.restaurant.update({
      where: { id },
      data: {
        name: dto.name,
        address: dto.address,
        city: dto.city,
        phone: dto.phone,
        website: dto.website,
        lat: dto.lat,
        lng: dto.lng,
        timezone: dto.timezone,
        maxPartySize: dto.max_party_size,
        active: dto.active,
      },
    });
  }
}
