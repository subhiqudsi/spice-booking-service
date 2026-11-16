import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export const RESERVATION_FILTERS = ['upcoming', 'previous', 'all'] as const;
export type ReservationFilter = (typeof RESERVATION_FILTERS)[number];

export class ListReservationsQuery {
  /** upcoming: from now on, soonest first. previous: before now, latest first. all: latest first. */
  @IsOptional()
  @IsIn(RESERVATION_FILTERS)
  filter?: ReservationFilter;

  @IsOptional()
  @IsIn(['pending', 'confirmed', 'failed'])
  status?: 'pending' | 'confirmed' | 'failed';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /** `next_cursor` from the previous page. */
  @IsOptional()
  @Matches(/^res_[0-9A-Z]{26}$/, { message: 'cursor must be a next_cursor value from a previous page' })
  cursor?: string;
}

export class CreateReservationDto {
  @IsString()
  @MaxLength(64)
  restaurant_id: string;

  /** ISO 8601 with an offset, e.g. 2026-11-20T19:00:00+04:00 */
  @IsISO8601({ strict: true })
  @Matches(/(Z|[+-]\d{2}:\d{2})$/, { message: 'datetime must include a timezone offset' })
  datetime: string;

  @IsInt()
  @Min(1)
  @Max(100)
  party_size: number;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  slot_token?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
