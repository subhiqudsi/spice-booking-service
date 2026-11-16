import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { APP_ENV, Env } from '@app/common';
import { AppModule } from './app.module';
import { configureApp, createAdapter } from './bootstrap';

async function main(): Promise<void> {
  process.env.APP_NAME ??= 'api';
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, createAdapter(), { bufferLogs: true });
  await configureApp(app);
  const env = app.get<Env>(APP_ENV);
  await app.listen(env.PORT, '0.0.0.0');
}

void main();
