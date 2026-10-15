import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FieldDefinitionDto {
  @ApiProperty({ pattern: '^[a-z][a-z0-9_]{0,39}$' })
  @IsString() @Matches(/^[a-z][a-z0-9_]{0,39}$/) key!: string;
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @IsString() @MinLength(1) @MaxLength(100) label!: string;
  @ApiProperty({ enum: ['text', 'date', 'select'], description: 'Select fields require options; other field types cannot include options.' })
  @IsString() type!: 'text' | 'date' | 'select';
  @ApiProperty()
  @IsBoolean() required!: boolean;
  @ApiPropertyOptional({ type: [String], minItems: 1, maxItems: 50, description: 'Required for select fields; each option is at most 100 characters.' })
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) options?: string[];
}

export class CreateDocumentTypeDto {
  @ApiProperty({ maxLength: 80, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' })
  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @MaxLength(80) slug!: string;
  @ApiProperty({ minLength: 1, maxLength: 160 })
  @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @ApiPropertyOptional({ maxLength: 2000, default: '' })
  @IsString() @MaxLength(2000) description = '';
  @ApiPropertyOptional({ type: 'array', items: { type: 'string', maxLength: 300 }, maxItems: 40, description: 'No official requirements are seeded.' })
  @IsArray() @ArrayMaxSize(40) requirements: string[] = [];
  @ApiPropertyOptional({ type: () => [FieldDefinitionDto], maxItems: 30, default: [] })
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => FieldDefinitionDto) fields: FieldDefinitionDto[] = [];
}

export class UpdateDocumentTypeDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 160 })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) name?: string;
  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional({ type: 'array', items: { type: 'string', maxLength: 300 }, maxItems: 40 })
  @IsOptional() @IsArray() @ArrayMaxSize(40) requirements?: string[];
  @ApiPropertyOptional({ type: () => [FieldDefinitionDto], maxItems: 30 })
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => FieldDefinitionDto) fields?: FieldDefinitionDto[];
}
