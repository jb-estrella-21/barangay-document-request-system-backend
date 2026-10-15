import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, StaffUser } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export type AuditInput = {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(tx: Prisma.TransactionClient, input: AuditInput): Promise<unknown> {
    return tx.auditEvent.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        before: input.before,
        after: input.after,
      },
    });
  }

  async list(query: { cursor?: string; limit: number; action?: string; actorId?: string }) {
    const take = Math.min(Math.max(query.limit, 1), 100);
    const cursor = decodeCursor(query.cursor);
    if (query.cursor && !cursor) throw new BadRequestException('cursor is invalid');
    const rows = await this.prisma.auditEvent.findMany({
      where: {
        ...(query.action ? { action: query.action } : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(cursor ? { OR: [{ createdAt: { lt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      include: { actor: { select: { id: true, username: true, role: true } } },
    });
    const hasMore = rows.length > take;
    const data = rows.slice(0, take);
    return {
      data,
      nextCursor: hasMore && data.length ? encodeCursor(data[data.length - 1].createdAt, data[data.length - 1].id) : null,
    };
  }
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString('base64url');
}

function decodeCursor(value?: string): { createdAt: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { createdAt?: string; id?: string };
    if (!parsed.createdAt || !parsed.id || Number.isNaN(Date.parse(parsed.createdAt)) || !isUuid(parsed.id)) return null;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch { return null; }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
