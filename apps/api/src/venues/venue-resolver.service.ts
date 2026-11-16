import { Injectable } from '@nestjs/common';
import { Restaurant, VenueMapping } from '@prisma/client';
import { DomainError, ErrorCode } from '@app/common';
import { PrismaService } from '@app/database';

export interface ResolvedVenue {
  restaurant: Restaurant;
  mapping: VenueMapping;
}

/** Restaurant → verified, bookable venue mapping. Shared by shifts and reservations. */
@Injectable()
export class VenueResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(restaurantId: string, partySize: number): Promise<ResolvedVenue> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      include: { venueMappings: { where: { status: 'verified' }, orderBy: { verifiedAt: 'desc' } } },
    });
    if (!restaurant || !restaurant.active) {
      throw new DomainError(ErrorCode.RESTAURANT_NOT_FOUND, `Restaurant ${restaurantId} was not found.`);
    }
    if (partySize > restaurant.maxPartySize) {
      throw new DomainError(ErrorCode.VALIDATION_ERROR, `party_size must be ${restaurant.maxPartySize} or less.`, [
        { field: 'party_size', issue: `must be <= ${restaurant.maxPartySize}` },
      ]);
    }
    const mapping = restaurant.venueMappings[0];
    if (!mapping) {
      throw new DomainError(ErrorCode.VENUE_NOT_MAPPED, `Restaurant ${restaurantId} has no verified reservation venue.`);
    }
    if (!mapping.bookable) {
      throw new DomainError(
        ErrorCode.VENUE_NOT_BOOKABLE,
        `Restaurant ${restaurantId} can't be booked automatically on ${mapping.platform}.`,
      );
    }
    const { venueMappings: _omit, ...plain } = restaurant;
    return { restaurant: plain, mapping };
  }
}
