import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { validateFieldDefinitions } from '../common/validation';
import { CreateDocumentTypeDto, UpdateDocumentTypeDto } from './catalog.dto';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async publicList() {
    const types = await this.prisma.documentType.findMany({
      where: { isActive: true },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      orderBy: [{ slug: 'asc' }],
    });
    return types.map(({ id, slug, versions }) => {
      const current = versions[0];
      return { id, slug, ...versionDto(current) };
    });
  }

  async staffList() {
    const types = await this.prisma.documentType.findMany({
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      orderBy: [{ slug: 'asc' }],
    });
    return types.map(({ id, slug, isActive, versions }) => ({ id, slug, isActive, ...versionDto(versions[0]) }));
  }

  async create(actorId: string, dto: CreateDocumentTypeDto) {
    const fields = validateFieldDefinitions(dto.fields);
    const requirements = validateRequirements(dto.requirements);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const type = await tx.documentType.create({ data: { slug: dto.slug } });
        const version = await tx.documentTypeVersion.create({
          data: {
            documentTypeId: type.id, version: 1, name: dto.name.trim(), description: dto.description.trim(),
            requirements, fieldDefinitions: fields as Prisma.InputJsonValue, createdById: actorId,
          },
        });
        await this.audit.record(tx, { actorId, action: 'DOCUMENT_TYPE_CREATED', targetType: 'document_type', targetId: type.id, after: { slug: type.slug, version: 1, active: true } });
        return { id: type.id, slug: type.slug, isActive: type.isActive, ...versionDto(version) };
      });
    } catch (error) {
      if (isUniqueConflict(error)) throw new ConflictException('A document type with this slug already exists');
      throw error;
    }
  }

  async update(actorId: string, id: string, dto: UpdateDocumentTypeDto) {
    if (!Object.keys(dto).length) throw new BadRequestException('At least one catalog field is required');
    if (dto.fields) validateFieldDefinitions(dto.fields);
    if (dto.requirements) validateRequirements(dto.requirements);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const type = await tx.documentType.findUnique({ where: { id } });
        if (!type) throw new NotFoundException('Document type not found');
        const current = await tx.documentTypeVersion.findUnique({ where: { documentTypeId_version: { documentTypeId: id, version: type.currentVersion } } });
        if (!current) throw new NotFoundException('Current document type version not found');
        const nextVersion = type.currentVersion + 1;
        const version = await tx.documentTypeVersion.create({
          data: {
            documentTypeId: id,
            version: nextVersion,
            name: dto.name?.trim() ?? current.name,
            description: dto.description?.trim() ?? current.description,
            requirements: (dto.requirements ?? current.requirements) as Prisma.InputJsonValue,
            fieldDefinitions: (dto.fields ?? current.fieldDefinitions) as Prisma.InputJsonValue,
            createdById: actorId,
          },
        });
        const changed = await tx.documentType.updateMany({ where: { id, currentVersion: type.currentVersion }, data: { currentVersion: nextVersion } });
        if (changed.count !== 1) throw new ConflictException('Document type was updated by another administrator');
        await this.audit.record(tx, {
          actorId, action: 'DOCUMENT_TYPE_UPDATED', targetType: 'document_type', targetId: id,
          before: { version: current.version }, after: { version: nextVersion },
        });
        return { id, slug: type.slug, isActive: type.isActive, ...versionDto(version) };
      });
    } catch (error) {
      if (isUniqueConflict(error)) throw new ConflictException('Document type was updated by another administrator');
      throw error;
    }
  }

  async setActive(actorId: string, id: string, isActive: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const type = await tx.documentType.findUnique({ where: { id } });
      if (!type) throw new NotFoundException('Document type not found');
      if (type.isActive === isActive) return { id, isActive };
      await tx.documentType.update({ where: { id }, data: { isActive } });
      await this.audit.record(tx, {
        actorId, action: isActive ? 'DOCUMENT_TYPE_ACTIVATED' : 'DOCUMENT_TYPE_DEACTIVATED',
        targetType: 'document_type', targetId: id, before: { isActive: type.isActive }, after: { isActive },
      });
      return { id, isActive };
    });
  }

  async getActiveType(tx: Prisma.TransactionClient | PrismaService, id: string) {
    const type = await tx.documentType.findUnique({ where: { id }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
    if (!type || !type.isActive) throw new NotFoundException('Document type is not available');
    const current = type.versions[0];
    if (!current) throw new NotFoundException('Document type is not available');
    return { type, current };
  }
}

function versionDto(version: { id: string; version: number; name: string; description: string; requirements: Prisma.JsonValue; fieldDefinitions: Prisma.JsonValue } | undefined) {
  if (!version) return {};
  return {
    documentTypeVersionId: version.id,
    version: version.version,
    name: version.name,
    description: version.description,
    requirements: version.requirements,
    fields: version.fieldDefinitions,
  };
}

function validateRequirements(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length > 300)) {
    throw new BadRequestException('requirements must be an array of up to 40 short strings');
  }
  return value.map((entry) => entry.trim()).filter(Boolean);
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'P2002';
}
