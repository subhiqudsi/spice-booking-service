import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { BookingFailureCode, QUEUES, ScriptOperation, ScriptRepairJobData } from '@app/common';
import { AuditService } from '@app/audit';

/**
 * Failures that mean the script itself is broken, so a repair can help. A blocked or down platform
 * (PLATFORM_BLOCKED, PLATFORM_UNAVAILABLE), a taken slot or an unknown outcome is not a script
 * problem and does not start a repair.
 */
export const REPAIR_TRIGGERING_FAILURES = new Set<string>([
  BookingFailureCode.SCRIPT_FAILED,
  BookingFailureCode.UNEXPECTED_STEP,
  BookingFailureCode.CONFIRMATION_MISMATCH,
]);

/** A repair that finished (or gave up) blocks new repairs for the same script for this long. */
export const REPAIR_COOLDOWN_S = 30 * 60;

/**
 * Starts the self-healing loop from a failure (DESIGN.md §7.5). There is no schedule and no error-rate
 * threshold: the first script failure starts a repair. The job id is `<platform>-<operation>`, so
 * failures that arrive while a repair is queued, running or cooling down are folded into it.
 */
@Injectable()
export class RepairTriggerService {
  private readonly logger = new Logger(RepairTriggerService.name);

  constructor(
    @InjectQueue(QUEUES.SCRIPT_REPAIR) private readonly queue: Queue<ScriptRepairJobData>,
    private readonly audit: AuditService,
  ) {}

  async onScriptFailure(
    platform: string,
    operation: ScriptOperation,
    trigger: Omit<ScriptRepairJobData['trigger'], 'occurredAt'>,
  ): Promise<void> {
    if (!REPAIR_TRIGGERING_FAILURES.has(trigger.errorCode)) return;
    const jobId = `${platform}-${operation}`;
    try {
      const existing = await this.queue.getJob(jobId);
      if (existing) {
        this.logger.log({ jobId, errorCode: trigger.errorCode }, 'script repair already queued, running or cooling down');
        return;
      }
      await this.queue.add(
        'repair',
        { platform, operation, trigger: { ...trigger, occurredAt: new Date().toISOString() } },
        {
          jobId,
          attempts: 1,
          // Keeping the finished job for the cooldown makes the same jobId a no-op until it expires.
          removeOnComplete: { age: REPAIR_COOLDOWN_S },
          removeOnFail: { age: REPAIR_COOLDOWN_S },
        },
      );
      await this.audit.record({
        actorType: 'system',
        actorId: 'repair-trigger',
        action: 'agent.repair.requested',
        resourceType: 'script',
        resourceId: jobId,
        outcome: 'success',
        requestId: trigger.requestId,
        metadata: { error_code: trigger.errorCode, reservation_id: trigger.reservationId ?? null },
      });
    } catch (err) {
      // Never let the repair trigger break the booking flow.
      this.logger.error({ err, jobId }, 'could not queue script repair');
    }
  }
}
