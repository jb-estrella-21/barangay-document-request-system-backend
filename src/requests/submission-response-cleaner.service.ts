import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class SubmissionResponseCleaner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SubmissionResponseCleaner.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => { void this.clearExpiredResponses(); }, 60 * 60 * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async clearExpiredResponses(): Promise<void> {
    try {
      await this.prisma.submissionIdempotency.updateMany({
        where: { responseExpiresAt: { lte: new Date() }, encryptedResponse: { not: '' } },
        data: { encryptedResponse: '' },
      });
    } catch {
      this.logger.warn('Expired idempotency response cleanup failed');
    }
  }
}
