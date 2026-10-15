import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { RequestStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RequestQueueQuery {
  @ApiPropertyOptional({ enum: RequestStatus })
  @IsOptional() @IsEnum(RequestStatus) status?: RequestStatus;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID() documentTypeId?: string;
  @ApiPropertyOptional({ type: Boolean, description: 'When true, restrict to overdue requests in Submitted, Under review, or Processing.' })
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() overdue?: boolean;
  @ApiPropertyOptional({ format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
  @IsOptional() @IsString() releaseDateFrom?: string;
  @ApiPropertyOptional({ format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
  @IsOptional() @IsString() releaseDateTo?: string;
  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page.' })
  @IsOptional() @IsString() cursor?: string;
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100, default: 25 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
}

export class RequestQueueSearchDto extends RequestQueueQuery {
  @ApiProperty({ maxLength: 160, description: 'Searches request reference, applicant name, and contact number. Submit in the JSON body, never in a URL.' })
  @IsString() @MaxLength(160) search!: string;
}

export class TransitionRequestDto {
  @ApiProperty({ enum: RequestStatus, description: 'Must be an allowed next status for the current request state.' })
  @IsEnum(RequestStatus) toStatus!: RequestStatus;
  @ApiPropertyOptional({ maxLength: 1000, description: 'Required when rejecting or cancelling.' })
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
  @ApiPropertyOptional({ maxLength: 1000, description: 'Required when rejecting or cancelling; visible to the resident.' })
  @IsOptional() @IsString() @MaxLength(1000) publicMessage?: string;
  @ApiPropertyOptional({ maxLength: 2000, description: 'Private staff note; never returned by public tracking.' })
  @IsOptional() @IsString() @MaxLength(2000) internalNote?: string;
}

export class ReleaseDateDto {
  @ApiProperty({ format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Date interpreted in Asia/Manila; cannot be in the past.' })
  @IsString() @MaxLength(10) expectedReleaseDate!: string;
  @ApiPropertyOptional({ maxLength: 1000, description: 'Required when changing a previously set expected date.' })
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
