import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RequestStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { barangayToday, formatDateOnly, parseDateOnly } from '../common/date.util';
import { PrismaService } from '../database/prisma.service';
import { RequestQueueQuery, ReleaseDateDto, TransitionRequestDto } from './staff-requests.dto';

const overdueStatuses: RequestStatus[] = [RequestStatus.SUBMITTED, RequestStatus.UNDER_REVIEW, RequestStatus.PROCESSING];
const terminalStatuses: RequestStatus[] = [RequestStatus.RELEASED, RequestStatus.REJECTED, RequestStatus.CANCELLED];

@Injectable()
export class StaffRequestsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async list(query: RequestQueueQuery & { search?: string }) {
    const limit = query.limit ?? 25;
    if (query.overdue && query.status && !overdueStatuses.includes(query.status)) throw new BadRequestException('The overdue filter only applies to submitted, under-review, and processing requests');
    const cursor = decodeCursor(query.cursor);
    if (query.cursor && !cursor) throw new BadRequestException('cursor is invalid');
    const today = parseDateOnly(barangayToday());
    const releaseDateFilter: Prisma.DateTimeNullableFilter = {
      ...(query.releaseDateFrom ? { gte: dateFilter(query.releaseDateFrom) } : {}),
      ...(query.releaseDateTo ? { lte: dateFilter(query.releaseDateTo) } : {}),
      ...(query.overdue ? { lt: today } : {}),
    };
    const where: Prisma.DocumentRequestWhereInput = {
      ...(query.status ? { status: query.status } : query.overdue ? { status: { in: overdueStatuses } } : {}),
      ...(query.documentTypeId ? { documentTypeVersion: { documentTypeId: query.documentTypeId } } : {}),
      ...(query.search ? { OR: [
        { reference: { contains: query.search, mode: 'insensitive' } },
        { fullName: { contains: query.search, mode: 'insensitive' } },
        { contactNumber: { contains: query.search } },
      ] } : {}),
      ...(query.releaseDateFrom || query.releaseDateTo || query.overdue ? { expectedReleaseDate: releaseDateFilter } : {}),
      ...(cursor ? { AND: [{ OR: [{ createdAt: { lt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } }] }] } : {}),
    };
    const rows = await this.prisma.documentRequest.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true, reference: true, status: true, fullName: true, contactNumber: true,
        expectedReleaseDate: true, readyAt: true, createdAt: true, version: true,
        documentTypeVersion: { select: { name: true, version: true, documentTypeId: true } },
      },
    });
    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit).map((request) => ({ ...request, expectedReleaseDate: formatDateOnly(request.expectedReleaseDate) }));
    const last = rows[Math.min(limit, rows.length) - 1];
    return { data, nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null };
  }

  async get(id: string) {
    const request = await this.prisma.documentRequest.findUnique({
      where: { id },
      include: {
        documentTypeVersion: true,
        history: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { actor: { select: { id: true, username: true, role: true } } } },
      },
    });
    if (!request) throw new NotFoundException('Request not found');
    const { trackingSecretHash: _secretHash, ...safe } = request;
    return { ...safe, expectedReleaseDate: formatDateOnly(request.expectedReleaseDate) };
  }

  async transition(actorId: string, id: string, expectedVersion: number, dto: TransitionRequestDto) {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new BadRequestException('A valid If-Match request version is required');
    if (requiresReason(dto.toStatus) && !dto.reason?.trim()) {
      throw new BadRequestException('A reason is required for rejection or cancellation');
    }
    if (requiresReason(dto.toStatus) && !dto.publicMessage?.trim()) {
      throw new BadRequestException('A public message is required for rejection or cancellation');
    }

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.documentRequest.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Request not found');
      if (current.version !== expectedVersion) throw new ConflictException({ message: 'Request changed since it was loaded; refresh and retry', code: 'STALE_REQUEST_VERSION' });
      if (!canTransition(current.status, dto.toStatus)) throw new ConflictException({ message: `Transition from ${current.status} to ${dto.toStatus} is not allowed`, code: 'INVALID_STATUS_TRANSITION' });

      const now = new Date();
      const publicMessage = dto.publicMessage?.trim() || defaultPublicMessage(dto.toStatus);
      const update = await tx.documentRequest.updateMany({
        where: { id, version: expectedVersion },
        data: {
          status: dto.toStatus,
          publicStatusMessage: publicMessage,
          version: { increment: 1 },
          ...(dto.toStatus === RequestStatus.READY_FOR_PICKUP ? { readyAt: now } : {}),
          ...(dto.toStatus === RequestStatus.RELEASED ? { releasedAt: now } : {}),
        },
      });
      if (update.count !== 1) throw new ConflictException({ message: 'Request changed since it was loaded; refresh and retry', code: 'STALE_REQUEST_VERSION' });
      const updated = await tx.documentRequest.findUniqueOrThrow({ where: { id } });
      await tx.requestStatusHistory.create({
        data: {
          requestId: id, eventType: 'STATUS_CHANGED', fromStatus: current.status, toStatus: dto.toStatus,
          reason: dto.reason?.trim(), publicMessage, internalNote: dto.internalNote?.trim(), actorId,
        },
      });
      await this.audit.record(tx, {
        actorId, action: 'REQUEST_STATUS_CHANGED', targetType: 'document_request', targetId: id,
        before: { status: current.status, version: current.version }, after: { status: updated.status, version: updated.version, readyAt: updated.readyAt, releasedAt: updated.releasedAt },
      });
      return { id, status: updated.status, version: updated.version, readyAt: updated.readyAt, releasedAt: updated.releasedAt, publicStatusMessage: updated.publicStatusMessage };
    });
  }

  async updateReleaseDate(actorId: string, id: string, expectedVersion: number, dto: ReleaseDateDto) {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new BadRequestException('A valid If-Match request version is required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.expectedReleaseDate)) throw new BadRequestException('expectedReleaseDate must use YYYY-MM-DD');
    const parsed = parseDateOnly(dto.expectedReleaseDate);
    if (formatDateOnly(parsed) !== dto.expectedReleaseDate) throw new BadRequestException('expectedReleaseDate is not a valid date');
    if (dto.expectedReleaseDate < barangayToday()) throw new BadRequestException('expectedReleaseDate cannot be in the past');

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.documentRequest.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Request not found');
      if (current.version !== expectedVersion) throw new ConflictException({ message: 'Request changed since it was loaded; refresh and retry', code: 'STALE_REQUEST_VERSION' });
      if (terminalStatuses.includes(current.status) || current.status === RequestStatus.READY_FOR_PICKUP) throw new ConflictException('Release date cannot be changed after pickup readiness or closure');
      const oldDate = current.expectedReleaseDate;
      if (oldDate && formatDateOnly(oldDate) !== dto.expectedReleaseDate && !dto.reason?.trim()) throw new BadRequestException('A reason is required when revising an expected release date');
      if (oldDate && formatDateOnly(oldDate) === dto.expectedReleaseDate) return { id, expectedReleaseDate: dto.expectedReleaseDate, version: current.version };

      const update = await tx.documentRequest.updateMany({
        where: { id, version: expectedVersion },
        data: { expectedReleaseDate: parsed, version: { increment: 1 } },
      });
      if (update.count !== 1) throw new ConflictException({ message: 'Request changed since it was loaded; refresh and retry', code: 'STALE_REQUEST_VERSION' });
      const updated = await tx.documentRequest.findUniqueOrThrow({ where: { id } });
      await tx.requestStatusHistory.create({
        data: { requestId: id, eventType: 'RELEASE_DATE_CHANGED', oldReleaseDate: oldDate, newReleaseDate: parsed, reason: dto.reason?.trim(), actorId },
      });
      await this.audit.record(tx, {
        actorId, action: 'REQUEST_RELEASE_DATE_CHANGED', targetType: 'document_request', targetId: id,
        before: { expectedReleaseDate: formatDateOnly(oldDate), version: current.version }, after: { expectedReleaseDate: dto.expectedReleaseDate, version: updated.version },
      });
      return { id, expectedReleaseDate: dto.expectedReleaseDate, version: updated.version };
    });
  }

  async summary() {
    const today = parseDateOnly(barangayToday());
    const [pending, processing, ready, overdue] = await Promise.all([
      this.prisma.documentRequest.count({ where: { status: { in: [RequestStatus.SUBMITTED, RequestStatus.UNDER_REVIEW] } } }),
      this.prisma.documentRequest.count({ where: { status: RequestStatus.PROCESSING } }),
      this.prisma.documentRequest.count({ where: { status: RequestStatus.READY_FOR_PICKUP } }),
      this.prisma.documentRequest.count({ where: { status: { in: overdueStatuses }, expectedReleaseDate: { lt: today } } }),
    ]);
    return { pending, processing, ready, overdue };
  }
}

function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  const allowed: Record<RequestStatus, RequestStatus[]> = {
    SUBMITTED: [RequestStatus.UNDER_REVIEW, RequestStatus.REJECTED, RequestStatus.CANCELLED],
    UNDER_REVIEW: [RequestStatus.PROCESSING, RequestStatus.REJECTED, RequestStatus.CANCELLED],
    PROCESSING: [RequestStatus.READY_FOR_PICKUP, RequestStatus.REJECTED, RequestStatus.CANCELLED],
    READY_FOR_PICKUP: [RequestStatus.RELEASED, RequestStatus.CANCELLED],
    RELEASED: [], REJECTED: [], CANCELLED: [],
  };
  return allowed[from].includes(to);
}

function requiresReason(status: RequestStatus): boolean {
  return status === RequestStatus.REJECTED || status === RequestStatus.CANCELLED;
}

function defaultPublicMessage(status: RequestStatus): string {
  const messages: Record<RequestStatus, string> = {
    SUBMITTED: 'Your request has been submitted.',
    UNDER_REVIEW: 'Your request is under review.',
    PROCESSING: 'Your request is being processed.',
    READY_FOR_PICKUP: 'Your document is ready for pickup.',
    RELEASED: 'Your document has been released.',
    REJECTED: 'Your request could not be approved. Please contact the barangay office.',
    CANCELLED: 'Your request has been closed. Please contact the barangay office if you need assistance.',
  };
  return messages[status];
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

function dateFilter(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Release date filters must use YYYY-MM-DD');
  const parsed = parseDateOnly(value);
  if (formatDateOnly(parsed) !== value) throw new BadRequestException('A release date filter is not a valid date');
  return parsed;
}
