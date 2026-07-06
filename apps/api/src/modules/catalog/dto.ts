import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length } from "class-validator";
import { ACCOUNT_TYPES } from "@ebizz/shared";

export class CreateAccountDto {
  @ApiProperty() @IsUUID() company_id!: string;
  @ApiProperty() @IsString() @Length(1, 20) code!: string;
  @ApiProperty() @IsString() @Length(1, 200) name!: string;
  @ApiProperty({ enum: ACCOUNT_TYPES }) @IsIn(ACCOUNT_TYPES) type!: (typeof ACCOUNT_TYPES)[number];
  @ApiPropertyOptional() @IsOptional() @IsUUID() parent_id?: string;
  @ApiPropertyOptional({ example: "USD" }) @IsOptional() @IsString() @Length(3, 3) currency?: string;
}

export class UpdateAccountDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 20) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) name?: string;
  @ApiPropertyOptional({ enum: ACCOUNT_TYPES }) @IsOptional() @IsIn(ACCOUNT_TYPES) type?: (typeof ACCOUNT_TYPES)[number];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_active?: boolean;
}

export class CreateLocationDto {
  @ApiProperty()
  @IsUUID()
  company_id!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address_line1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: "US" })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateLocationDto extends PartialType(CreateLocationDto) {}
