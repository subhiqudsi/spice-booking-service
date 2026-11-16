import { Global, Module } from '@nestjs/common';
import { ErrorLogService } from './error-log.service';

@Global()
@Module({
  providers: [ErrorLogService],
  exports: [ErrorLogService],
})
export class ErrorLogModule {}

export { AppLoggerModule, redactPaths } from './logger.module';
export { ErrorLogService, errorFingerprint } from './error-log.service';
export type { ErrorLogEntry, ErrorSource } from './error-log.service';
export { AllExceptionsFilter } from './all-exceptions.filter';
