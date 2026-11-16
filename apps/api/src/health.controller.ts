import { Controller, Get, HttpCode, Inject } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import Redis from 'ioredis';
import { REDIS } from '@app/common';
import { PrismaService } from '@app/database';
import { Public } from './auth/decorators';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  async health() {
    const [db, redis] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => 'ok').catch(() => 'down'),
      this.redis.ping().then(() => 'ok').catch(() => 'down'),
    ]);
    return { status: db === 'ok' && redis === 'ok' ? 'ok' : 'degraded', db, redis };
  }
}
