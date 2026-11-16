import type { IncomingMessage } from 'http';
import { INestApplication, ValidationError, ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import { Logger } from 'nestjs-pino';
import { DomainError, ErrorCode, ErrorDetail, resolveRequestId } from '@app/common';
import { AllExceptionsFilter, ErrorLogService } from '@app/logging';

function flatten(errors: ValidationError[], parent = ''): ErrorDetail[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = Object.values(e.constraints ?? {}).map((issue) => ({ field, issue }));
    return [...own, ...flatten(e.children ?? [], field)];
  });
}

export function createAdapter(): FastifyAdapter {
  return new FastifyAdapter({
    bodyLimit: 64 * 1024,
    trustProxy: true,
    // One request id for logs, audit, errors and queue jobs: the caller's x-request-id if safe, else a ULID.
    genReqId: (req: IncomingMessage) => resolveRequestId(req.headers['x-request-id']),
  });
}

/** Shared by main.ts and the e2e tests so both run the same pipeline. */
export async function configureApp(app: NestFastifyApplication): Promise<INestApplication> {
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.register(helmet);
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request, reply, done) => {
      void reply.header('x-request-id', request.id);
      done();
    });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new DomainError(ErrorCode.VALIDATION_ERROR, 'The request is invalid.', flatten(errors)),
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter(app.get(ErrorLogService)));
  return app;
}
