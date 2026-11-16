import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUES, ScriptRepairJobData } from '@app/common';
import { AuditService } from '@app/audit';
import { ErrorLogService } from '@app/logging';

/**
 * Entry point of the self-healing loop (DESIGN.md §7.5). Concurrency 1: one repair at a time.
 *
 * Placeholder until delivery-plan step 5/6: the script agent, validation gates, auto-commit and canary
 * promotion plug in here. For now it records the request so a person can act on it.
 */
@Processor(QUEUES.SCRIPT_REPAIR, { concurrency: 1 })
export class ScriptRepairProcessor extends WorkerHost {
  private readonly logger = new Logger(ScriptRepairProcessor.name);

  constructor(
    private readonly audit: AuditService,
    private readonly errorLog: ErrorLogService,
  ) {
    super();
  }

  async process(job: Job<ScriptRepairJobData>): Promise<'not_implemented'> {
    const { platform, operation, trigger } = job.data;
    this.logger.warn({ platform, operation, trigger }, 'script repair requested; agent not built yet');
    await this.errorLog.record({
      source: 'agent',
      severity: 'critical',
      errorCode: 'SCRIPT_REPAIR_NEEDED',
      message: `The ${platform} ${operation} script failed (${trigger.errorCode}); automatic repair is not built yet.`,
      requestId: trigger.requestId,
      reservationId: trigger.reservationId,
      context: { platform, operation, trigger_error: trigger.errorCode, venue_id: trigger.venueId ?? null },
    });
    await this.audit.record({
      actorType: 'agent',
      actorId: 'script-repair',
      action: 'agent.repair.failed',
      resourceType: 'script',
      resourceId: job.id ?? `${platform}-${operation}`,
      outcome: 'failure',
      requestId: trigger.requestId,
      metadata: { reason: 'not_implemented' },
    });
    return 'not_implemented';
  }
}
