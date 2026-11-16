import { Inject, Injectable } from '@nestjs/common';
import { DomainError, ErrorCode } from '@app/common';
import { RESERVATION_PROVIDERS, ReservationProvider } from './reservation-provider';

/** Picks the provider for a venue mapping's platform. */
@Injectable()
export class PlatformRouter {
  private readonly byPlatform: Map<string, ReservationProvider>;

  constructor(@Inject(RESERVATION_PROVIDERS) providers: ReservationProvider[]) {
    this.byPlatform = new Map(providers.map((p) => [p.platform, p]));
  }

  get(platform: string): ReservationProvider {
    const provider = this.byPlatform.get(platform);
    if (!provider) {
      throw new DomainError(ErrorCode.VENUE_NOT_MAPPED, `No provider is registered for platform "${platform}".`);
    }
    return provider;
  }

  platforms(): string[] {
    return [...this.byPlatform.keys()];
  }
}
