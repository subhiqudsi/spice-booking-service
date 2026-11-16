import { Type } from 'class-transformer';
import { IsInt, Matches, Max, Min } from 'class-validator';

export class GetShiftsQuery {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  party_size: number;
}
