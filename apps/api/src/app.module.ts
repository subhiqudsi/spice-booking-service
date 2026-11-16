import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule } from '@nestjs/throttler';
import { EnvModule, QUEUES, RedisModule } from '@app/common';
import { DatabaseModule } from '@app/database';
import { AppLoggerModule, ErrorLogModule } from '@app/logging';
import { AuditInterceptor, AuditModule } from '@app/audit';
import { ContactModule } from '@app/contact';
import { WebhooksModule } from '@app/webhooks';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health.controller';
import { ShiftsController } from './shifts/shifts.controller';
import { ShiftsService } from './shifts/shifts.service';
import { ReservationsController } from './reservations/reservations.controller';
import { ReservationsService } from './reservations/reservations.service';
import { VenueResolver } from './venues/venue-resolver.service';
import { RestaurantsController } from './internal/restaurants.controller';
import { VenueMappingsController } from './internal/venue-mappings.controller';
import { ApiKeysController } from './internal/api-keys.controller';
import { LogsController } from './internal/logs.controller';

@Module({
  imports: [
    EnvModule,
    AppLoggerModule,
    DatabaseModule,
    RedisModule,
    ErrorLogModule,
    AuditModule,
    ContactModule,
    WebhooksModule,
    BullModule.registerQueue({ name: QUEUES.SHIFTS }, { name: QUEUES.SUBMIT }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    AuthModule,
  ],
  controllers: [
    HealthController,
    ShiftsController,
    ReservationsController,
    RestaurantsController,
    VenueMappingsController,
    ApiKeysController,
    LogsController,
  ],
  providers: [
    VenueResolver,
    ShiftsService,
    ReservationsService,
    { provide: APP_INTERCEPTOR, useExisting: AuditInterceptor },
  ],
})
export class AppModule {}
