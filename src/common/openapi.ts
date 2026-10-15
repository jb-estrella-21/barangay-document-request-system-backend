import { applyDecorators, INestApplication } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiHeader,
  ApiResponse,
  DocumentBuilder,
  getSchemaPath,
  SwaggerModule,
} from '@nestjs/swagger';
import { ApiResponseOptions, OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProblemDetailsDto {
  @ApiProperty({ example: 'about:blank' }) type!: string;
  @ApiProperty({ example: 'Bad Request' }) title!: string;
  @ApiProperty({ example: 400 }) status!: number;
  @ApiProperty({ example: 'The request could not be completed' }) detail!: string;
  @ApiProperty({ example: '/api/v1/requests' }) instance!: string;
  @ApiProperty({ format: 'uuid' }) requestId!: string;
  @ApiPropertyOptional({ type: [String], description: 'Present for validation errors.' }) errors?: string[];
  @ApiPropertyOptional({ description: 'Stable machine-readable error code when provided.' }) code?: string;
}

export class FieldDefinitionSchema {
  @ApiProperty({ pattern: '^[a-z][a-z0-9_]{0,39}$' }) key!: string;
  @ApiProperty({ minLength: 1, maxLength: 100 }) label!: string;
  @ApiProperty({ enum: ['text', 'date', 'select'] }) type!: 'text' | 'date' | 'select';
  @ApiProperty() required!: boolean;
  @ApiPropertyOptional({ type: [String], minItems: 1, maxItems: 50, description: 'Required for select fields.' }) options?: string[];
}

export class CurrentStaff {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() username!: string;
  @ApiProperty({ enum: ['ADMINISTRATOR', 'PROCESSOR'] }) role!: string;
  @ApiProperty() mustChangePassword!: boolean;
}

export class StaffSafe {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() username!: string;
  @ApiProperty({ enum: ['ADMINISTRATOR', 'PROCESSOR'] }) role!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() mustChangePassword!: boolean;
}

export class DocumentType {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ format: 'uuid' }) documentTypeVersionId!: string;
  @ApiProperty() version!: number;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ type: [String] }) requirements!: string[];
  @ApiProperty({ type: () => [FieldDefinitionSchema] }) fields!: FieldDefinitionSchema[];
}

export class StaffDocumentType extends DocumentType {
  @ApiProperty() isActive!: boolean;
}

export type ProblemStatus = { status: number; description: string };

export function ApiProblemResponses(...responses: ProblemStatus[]): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(ProblemDetailsDto),
    ...responses.map(({ status, description }) => ApiResponse({
      status,
      description,
      content: {
        'application/problem+json': {
          schema: { $ref: getSchemaPath(ProblemDetailsDto) },
        },
      },
    })),
  );
}

export function ApiJsonResponse(
  status: number,
  description: string,
  schema: SchemaObject,
  headers?: ApiResponseOptions['headers'],
): MethodDecorator {
  return ApiResponse({ status, description, headers, content: { 'application/json': { schema } } });
}

export function ApiStaffCsrfHeaders(): MethodDecorator {
  return applyDecorators(
    ApiHeader({
      name: 'Origin', required: true,
      description: 'Must exactly match one of the server-configured CORS_ORIGINS values.',
      example: 'https://barangay.example',
    }),
    ApiHeader({
      name: 'X-CSRF-Token', required: true,
      description: 'Session-bound token returned by staff login or GET /staff/auth/me.',
    }),
  );
}

export function createOpenApiDocument(app: INestApplication, sessionCookieName: string): OpenAPIObject {
  const options = new DocumentBuilder()
    .setTitle('Barangay Document Request API')
    .setDescription(
      'Anonymous document requests and staff request processing API. Staff write requests require the configured Origin and a session-bound X-CSRF-Token.',
    )
    .setVersion('1.0.0')
    .addCookieAuth(sessionCookieName, { type: 'apiKey', in: 'cookie' }, 'cookie')
    .build();
  return SwaggerModule.createDocument(app, options, {
    extraModels: [ProblemDetailsDto, FieldDefinitionSchema, CurrentStaff, StaffSafe, DocumentType, StaffDocumentType],
  });
}

export function setupOpenApi(app: INestApplication, sessionCookieName: string): OpenAPIObject {
  const document = createOpenApiDocument(app, sessionCookieName);
  SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs-json' });
  return document;
}

export const schemas = {
  emptyObject: { type: 'object', additionalProperties: false } as SchemaObject,
  statusOk: {
    type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['ok'] } },
  } as SchemaObject,
  currentStaff: {
    type: 'object', required: ['id', 'username', 'role', 'mustChangePassword'],
    properties: {
      id: { type: 'string', format: 'uuid' }, username: { type: 'string' },
      role: { type: 'string', enum: ['ADMINISTRATOR', 'PROCESSOR'] }, mustChangePassword: { type: 'boolean' },
    },
  } as SchemaObject,
  safeStaff: {
    type: 'object', required: ['id', 'username', 'role', 'isActive', 'mustChangePassword'],
    properties: {
      id: { type: 'string', format: 'uuid' }, username: { type: 'string' },
      role: { type: 'string', enum: ['ADMINISTRATOR', 'PROCESSOR'] }, isActive: { type: 'boolean' },
      mustChangePassword: { type: 'boolean' },
    },
  } as SchemaObject,
  fieldDefinition: {
    type: 'object', required: ['key', 'label', 'type', 'required'],
    properties: {
      key: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,39}$' },
      label: { type: 'string', minLength: 1, maxLength: 100 },
      type: { type: 'string', enum: ['text', 'date', 'select'] }, required: { type: 'boolean' },
      options: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string', maxLength: 100 }, description: 'Required for select fields and prohibited for text/date fields.' },
    },
  } as SchemaObject,
  documentType: {
    type: 'object', required: ['id', 'slug', 'documentTypeVersionId', 'version', 'name', 'description', 'requirements', 'fields'],
    properties: {
      id: { type: 'string', format: 'uuid' }, slug: { type: 'string' },
      documentTypeVersionId: { type: 'string', format: 'uuid' }, version: { type: 'integer' },
      name: { type: 'string' }, description: { type: 'string' },
      requirements: { type: 'array', items: { type: 'string' } },
      fields: { type: 'array', items: { $ref: '#/components/schemas/FieldDefinitionSchema' } },
    },
  } as SchemaObject,
  staffDocumentType: {
    type: 'object', required: ['id', 'slug', 'isActive', 'documentTypeVersionId', 'version', 'name', 'description', 'requirements', 'fields'],
    properties: {
      id: { type: 'string', format: 'uuid' }, slug: { type: 'string' }, isActive: { type: 'boolean' },
      documentTypeVersionId: { type: 'string', format: 'uuid' }, version: { type: 'integer' },
      name: { type: 'string' }, description: { type: 'string' },
      requirements: { type: 'array', items: { type: 'string' } },
      fields: { type: 'array', items: { $ref: '#/components/schemas/FieldDefinitionSchema' } },
    },
  } as SchemaObject,
  page: (itemSchema: SchemaObject): SchemaObject => ({
    type: 'object', required: ['data', 'nextCursor'],
    properties: {
      data: { type: 'array', items: itemSchema },
      nextCursor: { type: 'string', nullable: true, description: 'Pass this value as cursor to fetch the next page.' },
    },
  }),
  staffQueueItem: {
    type: 'object', required: ['id', 'reference', 'status', 'fullName', 'contactNumber', 'expectedReleaseDate', 'readyAt', 'createdAt', 'version', 'documentTypeVersion'],
    properties: {
      id: { type: 'string', format: 'uuid' }, reference: { type: 'string' },
      status: { type: 'string', enum: ['SUBMITTED', 'UNDER_REVIEW', 'PROCESSING', 'READY_FOR_PICKUP', 'RELEASED', 'REJECTED', 'CANCELLED'] },
      fullName: { type: 'string' }, contactNumber: { type: 'string' },
      expectedReleaseDate: { type: 'string', format: 'date', nullable: true },
      readyAt: { type: 'string', format: 'date-time', nullable: true }, createdAt: { type: 'string', format: 'date-time' },
      version: { type: 'integer' },
      documentTypeVersion: { type: 'object', required: ['name', 'version', 'documentTypeId'], properties: {
        name: { type: 'string' }, version: { type: 'integer' }, documentTypeId: { type: 'string', format: 'uuid' },
      } },
    },
  } as SchemaObject,
  requestDetail: {
    type: 'object', required: ['id', 'reference', 'documentTypeVersionId', 'status', 'fullName', 'contactNumber', 'address', 'applicantFields', 'expectedReleaseDate', 'readyAt', 'releasedAt', 'publicStatusMessage', 'version', 'createdAt', 'updatedAt', 'documentTypeVersion', 'history'],
    properties: {
      id: { type: 'string', format: 'uuid' }, reference: { type: 'string' },
      documentTypeVersionId: { type: 'string', format: 'uuid' },
      status: { type: 'string', enum: ['SUBMITTED', 'UNDER_REVIEW', 'PROCESSING', 'READY_FOR_PICKUP', 'RELEASED', 'REJECTED', 'CANCELLED'] },
      fullName: { type: 'string' }, contactNumber: { type: 'string' }, address: { type: 'string' },
      applicantFields: { type: 'object', additionalProperties: { type: 'string' } },
      expectedReleaseDate: { type: 'string', format: 'date', nullable: true }, readyAt: { type: 'string', format: 'date-time', nullable: true },
      releasedAt: { type: 'string', format: 'date-time', nullable: true }, publicStatusMessage: { type: 'string', nullable: true },
      version: { type: 'integer' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
      documentTypeVersion: { type: 'object', required: ['id', 'documentTypeId', 'version', 'name', 'description', 'requirements', 'fieldDefinitions', 'createdById', 'createdAt'], description: 'Immutable document type configuration selected at submission.', properties: {
        id: { type: 'string', format: 'uuid' }, documentTypeId: { type: 'string', format: 'uuid' }, version: { type: 'integer' },
        name: { type: 'string' }, description: { type: 'string' }, requirements: { type: 'array', items: { type: 'string' } },
        fieldDefinitions: { type: 'array', items: { $ref: '#/components/schemas/FieldDefinitionSchema' } },
        createdById: { type: 'string', format: 'uuid', nullable: true }, createdAt: { type: 'string', format: 'date-time' },
      } },
      history: { type: 'array', items: { type: 'object', required: ['id', 'requestId', 'eventType', 'fromStatus', 'toStatus', 'oldReleaseDate', 'newReleaseDate', 'publicMessage', 'reason', 'internalNote', 'actorId', 'createdAt', 'actor'], properties: {
        id: { type: 'string', format: 'uuid' }, requestId: { type: 'string', format: 'uuid' },
        eventType: { type: 'string', enum: ['STATUS_CHANGED', 'RELEASE_DATE_CHANGED'] },
        fromStatus: { type: 'string', nullable: true, enum: ['SUBMITTED', 'UNDER_REVIEW', 'PROCESSING', 'READY_FOR_PICKUP', 'RELEASED', 'REJECTED', 'CANCELLED'] },
        toStatus: { type: 'string', nullable: true, enum: ['SUBMITTED', 'UNDER_REVIEW', 'PROCESSING', 'READY_FOR_PICKUP', 'RELEASED', 'REJECTED', 'CANCELLED'] },
        oldReleaseDate: { type: 'string', format: 'date', nullable: true }, newReleaseDate: { type: 'string', format: 'date', nullable: true },
        publicMessage: { type: 'string', nullable: true }, reason: { type: 'string', nullable: true },
        internalNote: { type: 'string', nullable: true, description: 'Private staff note; never returned by public tracking.' },
        actorId: { type: 'string', format: 'uuid', nullable: true }, createdAt: { type: 'string', format: 'date-time' },
        actor: { type: 'object', nullable: true, properties: { id: { type: 'string', format: 'uuid' }, username: { type: 'string' }, role: { type: 'string', enum: ['ADMINISTRATOR', 'PROCESSOR'] } } },
      } } },
    },
  } as SchemaObject,
  auditEvent: {
    type: 'object', required: ['id', 'actorId', 'action', 'targetType', 'targetId', 'before', 'after', 'createdAt', 'actor'],
    properties: {
      id: { type: 'string', format: 'uuid' }, actorId: { type: 'string', format: 'uuid', nullable: true },
      action: { type: 'string' }, targetType: { type: 'string' }, targetId: { type: 'string', nullable: true },
      before: { type: 'object', nullable: true }, after: { type: 'object', nullable: true }, createdAt: { type: 'string', format: 'date-time' },
      actor: { type: 'object', nullable: true, properties: { id: { type: 'string', format: 'uuid' }, username: { type: 'string' }, role: { type: 'string', enum: ['ADMINISTRATOR', 'PROCESSOR'] } } },
    },
  } as SchemaObject,
  health: {
    type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['ok'] } },
  } as SchemaObject,
  submission: {
    type: 'object', required: ['reference', 'trackingCredential', 'message'], properties: {
      reference: { type: 'string', minLength: 8, maxLength: 32 },
      trackingCredential: { type: 'string', minLength: 40, maxLength: 100, description: 'Private credential returned only at submission and same-key retry.' },
      message: { type: 'string' },
    },
  } as SchemaObject,
  login: {
    type: 'object', required: ['staff', 'expiresAt', 'csrfToken'], properties: {
      staff: { $ref: '#/components/schemas/StaffSafe' }, expiresAt: { type: 'string', format: 'date-time' }, csrfToken: { type: 'string' },
    },
  } as SchemaObject,
  me: {
    type: 'object', required: ['staff', 'csrfToken'], properties: {
      staff: { $ref: '#/components/schemas/CurrentStaff' }, csrfToken: { type: 'string' },
    },
  } as SchemaObject,
  trackedRequest: {
    type: 'object', required: ['reference', 'documentName', 'status', 'submittedAt', 'expectedReleaseDate', 'readyAt', 'releasedAt', 'statusMessage'],
    properties: {
      reference: { type: 'string' }, documentName: { type: 'string' },
      status: { type: 'string', enum: ['SUBMITTED', 'UNDER_REVIEW', 'PROCESSING', 'READY_FOR_PICKUP', 'RELEASED', 'REJECTED', 'CANCELLED'] },
      submittedAt: { type: 'string', format: 'date-time' }, expectedReleaseDate: { type: 'string', format: 'date', nullable: true },
      readyAt: { type: 'string', format: 'date-time', nullable: true }, releasedAt: { type: 'string', format: 'date-time', nullable: true },
      statusMessage: { type: 'string', nullable: true },
    },
  } as SchemaObject,
  summary: {
    type: 'object', required: ['pending', 'processing', 'ready', 'overdue'], properties: {
      pending: { type: 'integer' }, processing: { type: 'integer' }, ready: { type: 'integer' }, overdue: { type: 'integer' },
    },
  } as SchemaObject,
  transitionResult: {
    type: 'object', required: ['id', 'status', 'version', 'readyAt', 'releasedAt', 'publicStatusMessage'], properties: {
      id: { type: 'string', format: 'uuid' }, status: { type: 'string', enum: ['SUBMITTED', 'UNDER_REVIEW', 'PROCESSING', 'READY_FOR_PICKUP', 'RELEASED', 'REJECTED', 'CANCELLED'] },
      version: { type: 'integer' }, readyAt: { type: 'string', format: 'date-time', nullable: true }, releasedAt: { type: 'string', format: 'date-time', nullable: true }, publicStatusMessage: { type: 'string', nullable: true },
    },
  } as SchemaObject,
  releaseDateResult: {
    type: 'object', required: ['id', 'expectedReleaseDate', 'version'], properties: {
      id: { type: 'string', format: 'uuid' }, expectedReleaseDate: { type: 'string', format: 'date' }, version: { type: 'integer' },
    },
  } as SchemaObject,
  createStaff: {
    type: 'object', required: ['staff', 'temporaryPassword'], properties: {
      staff: { $ref: '#/components/schemas/StaffSafe' }, temporaryPassword: { type: 'string', description: 'One-time temporary password; require the staff member to change it at first sign-in.' },
    },
  } as SchemaObject,
  resetPassword: {
    type: 'object', required: ['staffId', 'temporaryPassword', 'mustChangePassword'], properties: {
      staffId: { type: 'string', format: 'uuid' }, temporaryPassword: { type: 'string', description: 'One-time temporary password; affected sessions are revoked.' }, mustChangePassword: { type: 'boolean', enum: [true] },
    },
  } as SchemaObject,
  staffList: { type: 'array', items: { $ref: '#/components/schemas/StaffSafe' } } as SchemaObject,
  publicDocumentTypes: { type: 'array', items: { $ref: '#/components/schemas/DocumentType' } } as SchemaObject,
  staffDocumentTypes: { type: 'array', items: { $ref: '#/components/schemas/StaffDocumentType' } } as SchemaObject,
};

export const staffMutationRoles = 'Requires an authenticated staff session and a valid Origin and X-CSRF-Token. Processors and administrators may use this operation.';

// Keep response options structurally checked by Nest Swagger while allowing shared JSON schema literals.
export type DocumentedResponse = ApiResponseOptions;
