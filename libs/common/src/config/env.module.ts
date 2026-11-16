import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { parseEnv } from './env.schema';

/** Injection token for the validated, typed environment (`Env`). */
export const APP_ENV = Symbol('APP_ENV');

@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, cache: true })],
  providers: [
    {
      provide: APP_ENV,
      // ConfigModule has loaded .env into process.env by the time this factory runs.
      useFactory: () => parseEnv(process.env),
    },
  ],
  exports: [APP_ENV],
})
export class EnvModule {}
