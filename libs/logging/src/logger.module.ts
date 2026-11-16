import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'http';
import { APP_ENV, Env, getRawRequestContext, resolveRequestId } from '@app/common';

/**
 * Paths pino blanks out on every line (DESIGN.md §8.2). The configured SERVICE_AUTH_HEADER is
 * added at runtime, so a custom header name is covered too.
 */
export function redactPaths(serviceAuthHeader: string): string[] {
  return [
    'req.headers["x-api-key"]',
    'req.headers.authorization',
    'req.headers.cookie',
    `req.headers["${serviceAuthHeader}"]`,
    'contact',
    '*.contact',
    '*.phone',
    '*.email',
    '*.encryptedContact',
    '*.serviceToken',
  ];
}

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [APP_ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          base: { app: process.env.APP_NAME ?? 'booking' },
          redact: { paths: redactPaths(env.SERVICE_AUTH_HEADER), censor: '[REDACTED]' },
          // Reuse the id Fastify already assigned, so log lines match audit and error rows.
          genReqId: (req: IncomingMessage, _res: ServerResponse) =>
            (req as IncomingMessage & { id?: string }).id ?? resolveRequestId(req.headers['x-request-id']),
          customProps: (req: IncomingMessage) => {
            const ctx = getRawRequestContext(req);
            return {
              api_client_id: ctx?.apiClient?.clientId,
              api_key_prefix: ctx?.apiClient?.keyPrefix,
              user_ref: ctx?.principal?.userRef,
            };
          },
          autoLogging: { ignore: (req: IncomingMessage) => req.url === '/health' },
          transport:
            env.NODE_ENV === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
  ],
})
export class AppLoggerModule {}
