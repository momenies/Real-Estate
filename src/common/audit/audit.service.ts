import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantStore } from '../tenancy/tenant-context';

export interface AuditEntry {
  action: string;
  officeId?: string | null;
  entity?: string;
  entityId?: string;
  meta?: Record<string, unknown>;
}

/**
 * The record of who changed what.
 *
 * Control without a trail is not control: suspending an office or loosening its
 * anti-spam guardrails are consequential acts, and six months later the only
 * honest answer to "who did this, and when?" is a row written at the time.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    const context = TenantStore.get();
    try {
      await this.prisma.auditLog.create({
        data: {
          officeId: entry.officeId ?? context?.officeId ?? null,
          actorUserId: context?.userId ?? null,
          actorType: context?.actor ?? 'system',
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId,
          meta: entry.meta as object,
        },
      });
    } catch (error) {
      // An audit failure must never take down the action it was recording -
      // but it must be loud, because a silent gap in the trail is worse than none.
      this.logger.error(
        `Failed to record audit entry "${entry.action}": ${(error as Error).message}`,
      );
    }
  }

  /** The network-wide trail, newest first. Super admin only. */
  async recent(take = 50) {
    return TenantStore.runAsSuperAdmin(() =>
      this.prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take,
      }),
    );
  }
}
