import { Module } from '@nestjs/common';
import { FakeProvider } from './fake.provider';
import { SevenRoomsProvider } from './sevenrooms.provider';
import { PlatformRouter } from './platform-router';
import { RESERVATION_PROVIDERS } from './reservation-provider';

@Module({
  providers: [
    FakeProvider,
    SevenRoomsProvider,
    {
      provide: RESERVATION_PROVIDERS,
      inject: [FakeProvider, SevenRoomsProvider],
      useFactory: (fake: FakeProvider, sevenRooms: SevenRoomsProvider) => [fake, sevenRooms],
    },
    PlatformRouter,
  ],
  exports: [PlatformRouter],
})
export class ProvidersModule {}

export * from './reservation-provider';
export { PlatformRouter } from './platform-router';
export { FakeProvider } from './fake.provider';
