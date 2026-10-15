import { IsBoolean, IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { StaffRole } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStaffUserDto {
  @ApiProperty({ minLength: 3, maxLength: 80, pattern: '^[a-zA-Z0-9._-]{3,80}$' })
  @IsString() @Matches(/^[a-zA-Z0-9._-]{3,80}$/) username!: string;
  @ApiProperty({ enum: StaffRole })
  @IsEnum(StaffRole) role!: StaffRole;
}

export class UpdateStaffUserDto {
  @ApiPropertyOptional({ enum: StaffRole })
  @IsOptional() @IsEnum(StaffRole) role?: StaffRole;
  @ApiPropertyOptional()
  @IsOptional() @IsBoolean() isActive?: boolean;
}
