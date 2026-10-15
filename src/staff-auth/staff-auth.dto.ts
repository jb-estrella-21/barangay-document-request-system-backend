import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ minLength: 1, maxLength: 80 })
  @IsString() @MinLength(1) @MaxLength(80) username!: string;
  @ApiProperty({ minLength: 1, maxLength: 200, writeOnly: true })
  @IsString() @MinLength(1) @MaxLength(200) password!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ minLength: 1, maxLength: 200, writeOnly: true })
  @IsString() @MinLength(1) @MaxLength(200) currentPassword!: string;
  @ApiProperty({ minLength: 12, maxLength: 200, writeOnly: true })
  @IsString() @MinLength(12) @MaxLength(200) newPassword!: string;
}
