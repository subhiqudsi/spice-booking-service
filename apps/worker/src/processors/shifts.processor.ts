import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUES, ShiftsJobData } from '@app/common';
import { PlatformRouter, ScriptFailureError, Shift } from '@app/providers';
import { RepairTriggerService } from '../repair/repair-trigger.service';

/** Fetches shift times on behalf of the API (the API waits for the result). */
@Processor(QUEUES.SHIFTS, { concurrency: 4 })
export class ShiftsProcessor extends WorkerHost {
  constructor(
    private readonly router: PlatformRouter,
    private readonly repair: RepairTriggerService,
  ) {
    super();
  }

  async process(job: Job<ShiftsJobData>): Promise<Shift[]> {
    const { platform, venueId, date, partySize, requestId } = job.data;
    try {
      return await this.router.get(platform).getShifts(venueId, date, partySize, { requestId });
    } catch (err) {
      // A broken shift-times script starts the self-healing loop straight away (DESIGN.md §7.5).
      if (err instanceof ScriptFailureError) {
        await this.repair.onScriptFailure(platform, 'get_shifts', {
          errorCode: err.errorCode,
          message: err.message,
          requestId,
          venueId,
        });
      }
      throw err;
    }
  }
}
