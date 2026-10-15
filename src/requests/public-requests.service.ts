import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, RequestStatus } from '@prisma/client';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { AppEnvironment } from '../config/validate-env';
import { decryptJson, encryptJson, randomToken, sha256 } from '../common/crypto.util';
import { formatDateOnly } from '../common/date.util';
import { validateApplicantFields } from '../common/validation';
import { FieldDefinition } from '../common/validation.types';
import { CatalogService } from '../catalog/catalog.service';
import { PrismaService } from '../database/prisma.service';
import { CreatePublicRequestDto } from './public-requests.dto';

type SubmissionResponse = { reference: string; trackingCredential: string; message: string };

@Injectable()
export class PublicRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  async submit(dto: CreatePublicRequestDto, idempotencyKey: string): Promise<SubmissionResponse> {
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) {
      throw new BadRequestException('Idempotency-Key must contain 16 to 200 characters');
    }
    const keyHash = sha256(idempotencyKey);
    const fingerprint = sha256(stableStringify(dto));
    const existing = await this.prisma.submissionIdempotency.findUnique({ where: { keyHash } });
    if (existing) return this.replay(existing, fingerprint);

    const trackingCredential = randomToken(32);
    const trackingSecretHash = sha256(trackingCredential);
    const reference = await this.newReference();
    const response: SubmissionResponse = { reference, trackingCredential, message: 'Request submitted. Save the reference and tracking credential to check progress.' };
    const encryptedResponse = encryptJson(response, this.config.get('IDEMPOTENCY_ENCRYPTION_KEY', { infer: true }));
    const responseExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    try {
      await this.prisma.$transaction(async (tx) => {
        const { current } = await this.catalog.getActiveType(tx, dto.documentTypeId);
        const definitions = current.fieldDefinitions as unknown as FieldDefinition[];
        const fields = validateApplicantFields(definitions, dto.fields);
        const created = await tx.documentRequest.create({
          data: {
            reference,
            trackingSecretHash,
            documentTypeVersionId: current.id,
            fullName: dto.applicant.fullName.trim(),
            contactNumber: dto.applicant.contactNumber.trim(),
            address: dto.applicant.address.trim(),
            applicantFields: fields as Prisma.InputJsonValue,
            publicStatusMessage: 'Your request has been submitted.',
          },
        });
        await tx.requestStatusHistory.create({
          data: { requestId: created.id, eventType: 'STATUS_CHANGED', toStatus: RequestStatus.SUBMITTED, publicMessage: 'Your request has been submitted.' },
        });
        await tx.submissionIdempotency.create({
          data: { keyHash, requestFingerprint: fingerprint, requestId: created.id, encryptedResponse, responseExpiresAt },
        });
      });
      return response;
    } catch (error) {
      if (isUniqueConflict(error)) {
        const raced = await this.prisma.submissionIdempotency.findUnique({ where: { keyHash } });
        if (raced) return this.replay(raced, fingerprint);
        throw new ConflictException('The request could not be created because its reference collided; retry with the same Idempotency-Key');
      }
      throw error;
    }
  }

  async track(reference: string, credential: string) {
    const request = await this.prisma.documentRequest.findUnique({
      where: { reference },
      select: {
        id: true, reference: true, trackingSecretHash: true, status: true, createdAt: true,
        expectedReleaseDate: true, readyAt: true, releasedAt: true, publicStatusMessage: true,
        documentTypeVersion: { select: { name: true } },
      },
    });
    const actual = Buffer.from(sha256(credential), 'hex');
    const expected = Buffer.from(request?.trackingSecretHash ?? sha256('missing-tracking-request'), 'hex');
    const matches = actual.length === expected.length && timingSafeEqual(actual, expected);
    if (!request || !matches) throw new NotFoundException({ message: 'Request was not found', code: 'TRACKING_NOT_FOUND' });
    return {
      reference: request.reference,
      documentName: request.documentTypeVersion.name,
      status: request.status,
      submittedAt: request.createdAt,
      expectedReleaseDate: formatDateOnly(request.expectedReleaseDate),
      readyAt: request.readyAt,
      releasedAt: request.releasedAt,
      statusMessage: request.publicStatusMessage,
    };
  }

  private async replay(existing: { keyHash: string; requestFingerprint: string; encryptedResponse: string; responseExpiresAt: Date }, fingerprint: string): Promise<SubmissionResponse> {
    if (existing.requestFingerprint !== fingerprint) throw new ConflictException('Idempotency-Key was already used for a different request');
    if (existing.responseExpiresAt <= new Date() || !existing.encryptedResponse) {
      await this.prisma.submissionIdempotency.updateMany({
        where: { keyHash: existing.keyHash, responseExpiresAt: { lte: new Date() }, encryptedResponse: { not: '' } },
        data: { encryptedResponse: '' },
      });
      throw new ConflictException({ message: 'The original request was accepted, but its retry response has expired. Contact the barangay with your request reference.', code: 'IDEMPOTENCY_RESPONSE_EXPIRED' });
    }
    return decryptJson<SubmissionResponse>(existing.encryptedResponse, this.config.get('IDEMPOTENCY_ENCRYPTION_KEY', { infer: true }));
  }

  private async newReference(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const year = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Manila', year: '2-digit' }).format(new Date());
      const suffix = randomBytes(10).toString('base64url').replace(/[-_]/g, '').slice(0, 10).toUpperCase();
      const reference = `BR-${year}-${suffix}`;
      if (!(await this.prisma.documentRequest.findUnique({ where: { reference }, select: { id: true } }))) return reference;
    }
    throw new ConflictException('Could not allocate a request reference; retry the submission');
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'P2002';
}
