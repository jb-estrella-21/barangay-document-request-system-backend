import { Transform, Type } from 'class-transformer';
import { IsDefined, IsObject, IsString, IsUUID, MaxLength, MinLength, ValidateNested, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ApplicantDto {
  @ApiProperty({ minLength: 2, maxLength: 160, example: 'Juan Dela Cruz' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(2) @MaxLength(160) fullName!: string;
  @ApiProperty({ minLength: 7, maxLength: 40, pattern: '^(?=.*\\d)[+0-9() .-]+$', example: '+639171234567' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(7) @MaxLength(40) @Matches(/^(?=.*\d)[+0-9() .-]+$/) contactNumber!: string;
  @ApiProperty({ minLength: 3, maxLength: 500 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(3) @MaxLength(500) address!: string;
}

export class CreatePublicRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID() documentTypeId!: string;
  @ApiProperty({ type: () => ApplicantDto })
  @IsDefined() @ValidateNested() @Type(() => ApplicantDto) applicant!: ApplicantDto;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string', maxLength: 1000 }, description: 'Values must match the selected active document type field definitions; date values use YYYY-MM-DD.' })
  @IsDefined() @IsObject() fields!: Record<string, unknown>;
}

export class TrackRequestDto {
  @ApiProperty({ minLength: 8, maxLength: 32, description: 'Human-readable request reference.' })
  @IsString() @MinLength(8) @MaxLength(32) reference!: string;
  @ApiProperty({ minLength: 40, maxLength: 100, writeOnly: true, description: 'Private credential returned once with successful submission.' })
  @IsString() @MinLength(40) @MaxLength(100) trackingCredential!: string;
}
