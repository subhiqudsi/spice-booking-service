import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { createRemoteJWKSet } from 'jose';
import { APP_ENV, Env } from '@app/common';
import { ApiKeysService } from './api-keys.service';
import { ApiKeyGuard } from './api-key.guard';
import { JWKS_RESOLVER, ServiceAuthGuard } from './service-auth.guard';
import { ApiKeyThrottlerGuard } from './throttler.guard';

@Module({
  providers: [
    ApiKeysService,
    {
      provide: JWKS_RESOLVER,
      inject: [APP_ENV],
      // Keys cached ~10 min; an unknown kid triggers a refresh at most every 30 s (key rotation).
      useFactory: (env: Env) =>
        createRemoteJWKSet(new URL(env.SERVICE_AUTH_JWKS_URL), {
          cacheMaxAge: 10 * 60_000,
          cooldownDuration: 30_000,
          timeoutDuration: 5_000,
        }),
    },
    // Order matters: API key first, then the service token, then rate limiting per key.
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_GUARD, useClass: ServiceAuthGuard },
    { provide: APP_GUARD, useClass: ApiKeyThrottlerGuard },
  ],
  exports: [ApiKeysService],
})
export class AuthModule {}
