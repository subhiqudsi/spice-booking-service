import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import Redis from 'ioredis';
import { APP_ENV } from './config/env.module';
import type { Env } from './config/env.schema';

/** Injection token for the shared ioredis client (cache, locks). */
export const REDIS = Symbol('REDIS');

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [APP_ENV],
      useFactory: (env: Env) => ({
        // BullMQ needs maxRetriesPerRequest: null on its connections.
        connection: new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }),
        defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 },
      }),
    }),
  ],
  providers: [
    {
      provide: REDIS,
      inject: [APP_ENV],
      useFactory: (env: Env) => new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 }),
    },
  ],
  exports: [REDIS, BullModule],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
