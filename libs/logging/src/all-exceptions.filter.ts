import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DomainError, ErrorCode, ErrorDetail, getRequestContext } from '@app/common';
import { ErrorLogService } from './error-log.service';

interface ErrorBody {
  error: { code: string; message: string; request_id: string; details: ErrorDetail[] };
}

/** 4xx codes worth a row in error_logs even though they are client errors. */
const LOGGED_CLIENT_CODES = new Set<string>([ErrorCode.IDEMPOTENCY_CONFLICT]);

const STATUS_FALLBACK_CODE: Record<number, ErrorCode> = {
  400: ErrorCode.VALIDATION_ERROR,
  401: ErrorCode.UNAUTHORIZED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  429: ErrorCode.RATE_LIMITED,
};

/**
 * One error shape for every response (DESIGN.md §4.3). Stack traces and internals stay on the
 * server: clients only get a code, a safe message and the request_id to quote to support.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpError');

  constructor(private readonly errorLog: ErrorLogService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const ctx = getRequestContext(req);

    const { status, code, message, details } = this.describe(exception);
    const body: ErrorBody = { error: { code, message, request_id: ctx.requestId, details } };

    if (status >= 500) {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error({ err, code, requestId: ctx.requestId }, 'request failed');
    } else {
      this.logger.warn({ code, status, requestId: ctx.requestId }, message);
    }

    if (status >= 500 || LOGGED_CLIENT_CODES.has(code)) {
      void this.errorLog.record({
        source: 'api',
        errorCode: code,
        message: exception instanceof Error ? exception.message : String(exception),
        stack: exception instanceof Error ? exception.stack : undefined,
        requestId: ctx.requestId,
        apiClientId: ctx.apiClient?.clientId,
        context: {
          route: req.routeOptions?.url,
          method: req.method,
          http_status: status,
          ...(exception instanceof DomainError ? exception.internal : {}),
        },
      });
    }

    void reply.header('x-request-id', ctx.requestId).status(status).send(body);
  }

  private describe(exception: unknown): { status: number; code: string; message: string; details: ErrorDetail[] } {
    if (exception instanceof DomainError) {
      return { status: exception.status, code: exception.code, message: exception.message, details: exception.details };
    }
    if (exception instanceof ThrottlerException) {
      return { status: 429, code: ErrorCode.RATE_LIMITED, message: 'Too many requests for this API key.', details: [] };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = STATUS_FALLBACK_CODE[status] ?? (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.VALIDATION_ERROR);
      const message = status >= 500 ? 'Internal error. Quote the request_id when reporting it.' : exception.message;
      return { status, code, message, details: [] };
    }
    // Fastify body parsing errors (malformed JSON, body too large) carry a statusCode.
    const statusCode = (exception as { statusCode?: unknown })?.statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return {
        status: statusCode,
        code: STATUS_FALLBACK_CODE[statusCode] ?? ErrorCode.VALIDATION_ERROR,
        message: (exception as Error).message,
        details: [],
      };
    }
    return {
      status: 500,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Internal error. Quote the request_id when reporting it.',
      details: [],
    };
  }
}
