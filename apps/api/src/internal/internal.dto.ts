import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { isValidTimeZone } from '@app/common';
import { SCOPES } from '../auth/api-key.util';
import type { Scope } from '../auth/api-key.util';

@ValidatorConstraint({ name: 'timeZone' })
class IsTimeZone implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isValidTimeZone(value);
  }
  defaultMessage(): string {
    return 'timezone must be an IANA time zone, e.g. Asia/Dubai';
  }
}

export class CreateRestaurantDto {
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, { message: 'id may contain letters, digits, - and _' })
  id: string;

  @IsString() @MaxLength(200) name: string;
  @IsString() @MaxLength(300) address: string;
  @IsString() @MaxLength(100) city: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsUrl() website?: string;
  @IsOptional() @IsNumber() lat?: number;
  @IsOptional() @IsNumber() lng?: number;
  @Validate(IsTimeZone) timezone: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) max_party_size?: number;
}

export class UpdateRestaurantDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsUrl() website?: string;
  @IsOptional() @IsNumber() lat?: number;
  @IsOptional() @IsNumber() lng?: number;
  @IsOptional() @Validate(IsTimeZone) timezone?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) max_party_size?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class CreateVenueMappingDto {
  @IsString() restaurant_id: string;
  @IsIn(['sevenrooms', 'fake']) platform: string;
  @IsString() @MaxLength(200) venue_id: string;
  @IsOptional() @IsUrl() venue_url?: string;
  /** A person creating a mapping by hand verifies it in the same step by default. */
  @IsOptional() @IsIn(['proposed', 'verified']) status?: 'proposed' | 'verified';
}

export class UpdateVenueMappingDto {
  @IsOptional() @IsIn(['proposed', 'verified', 'rejected', 'stale']) status?: 'proposed' | 'verified' | 'rejected' | 'stale';
  @IsOptional() @IsString() @MaxLength(200) venue_id?: string;
  @IsOptional() @IsUrl() venue_url?: string;
  @IsOptional() @IsBoolean() bookable?: boolean;
}

export class CreateApiKeyDto {
  /** Existing client; or give client_name to create a new client. */
  @IsOptional() @IsString() client_id?: string;
  @IsOptional() @IsString() @MaxLength(100) client_name?: string;
  @IsOptional() @IsString() @MaxLength(100) tenant?: string;
  @IsArray() @ArrayNotEmpty() @IsIn(SCOPES as unknown as string[], { each: true }) scopes: Scope[];
  @IsOptional() @IsDateString() expires_at?: string;
}

export class ListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

export class AuditLogQuery extends ListQuery {
  @IsOptional() @IsString() actor?: string;
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsString() resource_type?: string;
  @IsOptional() @IsString() resource_id?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class ErrorLogQuery extends ListQuery {
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() fingerprint?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class WebhookDeliveryQuery extends ListQuery {
  @IsOptional() @IsIn(['pending', 'delivered', 'dead']) status?: 'pending' | 'delivered' | 'dead';
}
