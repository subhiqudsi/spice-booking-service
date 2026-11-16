import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { sha256Hex } from '@app/common';
import { PrismaService } from '@app/database';

export type ErrorSource = 'api' | 'worker' | 'agent' | 'scheduler' | 'webhook';

export interface ErrorLogEntry {
  source: ErrorSource;
  severity?: 'error' | 'critical';
  errorCode: string;
  /** Must already be safe to store: no contact details, tokens or keys. */
  message: string;
  stack?: string;
  requestId?: string;
  apiClientId?: string;
  reservationId?: string;
  context?: Record<string, unknown>;
}

/** Errors with the same code and top stack frame share a fingerprint, so they group together. */
export function errorFingerprint(errorCode: string, stack?: string): string {
  const topFrame = stack?.split('\n').find((line) => line.trim().startsWith('at ')) ?? '';
  return sha256Hex(`${errorCode}|${topFrame.trim()}`).slice(0, 16);
}

/** Writes actionable errors to `error_logs` (DESIGN.md §8.2). Never throws. */
@Injectable()
export class ErrorLogService {
  private readonly logger = new Logger(ErrorLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: ErrorLogEntry): Promise<void> {
    const fingerprint = errorFingerprint(entry.errorCode, entry.stack);
    try {
      await this.prisma.errorLog.create({
        data: {
          id: ulid(),
          source: entry.source,
          severity: entry.severity ?? 'error',
          errorCode: entry.errorCode,
          message: entry.message.slice(0, 2000),
          stack: entry.stack?.slice(0, 8000),
          fingerprint,
          requestId: entry.requestId,
          apiClientId: entry.apiClientId,
          reservationId: entry.reservationId,
          context: (entry.context ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (err) {
      // The structured log line still carries the error if the table write fails.
      this.logger.error(
        { err, errorCode: entry.errorCode, fingerprint, requestId: entry.requestId },
        'ERROR_LOG_WRITE_FAILED',
      );
    }
  }
}
