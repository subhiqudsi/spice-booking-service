import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUES } from '@app/common';
import { AuditService } from './audit.service';
import { AuditInterceptor } from './audit.interceptor';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.AUDIT })],
  providers: [AuditService, AuditInterceptor],
  exports: [AuditService, AuditInterceptor],
})
export class AuditModule {}

export { AuditService } from './audit.service';
export { AuditInterceptor } from './audit.interceptor';
export { Audit, AUDIT_META } from './audit.decorator';
export type { AuditEntry, AuditActorType, AuditOutcome } from './audit.types';
