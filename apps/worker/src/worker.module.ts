import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { EnvModule, QUEUES, RedisModule } from '@app/common';
import { DatabaseModule } from '@app/database';
import { AppLoggerModule, ErrorLogModule } from '@app/logging';
import { AuditModule } from '@app/audit';
import { ProvidersModule } from '@app/providers';
import { WebhooksModule } from '@app/webhooks';
import { ShiftsProcessor } from './processors/shifts.processor';
import { SubmitProcessor } from './processors/submit.processor';
import { ReservationWebhookProcessor } from './processors/reservation-webhook.processor';
import { AuditWriterProcessor } from './processors/audit-writer.processor';
import { WebhookSweeper } from './webhook-sweeper.service';
import { RepairTriggerService } from './repair/repair-trigger.service';
import { ScriptRepairProcessor } from './repair/script-repair.processor';

@Module({
  imports: [
    EnvModule,
    AppLoggerModule,
    DatabaseModule,
    RedisModule,
    ErrorLogModule,
    AuditModule,
    ProvidersModule,
    WebhooksModule,
    ScheduleModule.forRoot(),
    BullModule.registerQueue({ name: QUEUES.SHIFTS }, { name: QUEUES.SUBMIT }, { name: QUEUES.SCRIPT_REPAIR }),
  ],
  providers: [
    ShiftsProcessor,
    SubmitProcessor,
    ReservationWebhookProcessor,
    AuditWriterProcessor,
    WebhookSweeper,
    RepairTriggerService,
    ScriptRepairProcessor,
  ],
})
export class WorkerModule {}
