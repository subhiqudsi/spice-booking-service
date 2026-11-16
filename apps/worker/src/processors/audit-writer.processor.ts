import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUES } from '@app/common';
import { PrismaService } from '@app/database';
import { AuditEntry, AuditService } from '@app/audit';

/** Inserts audit rows queued by AuditService (DESIGN.md §8.1). */
@Processor(QUEUES.AUDIT, { concurrency: 10 })
export class AuditWriterProcessor extends WorkerHost {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<AuditEntry>): Promise<void> {
    await AuditService.insert(this.prisma, job.data);
  }
}
