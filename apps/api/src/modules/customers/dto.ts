import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from "class-validator";

export class CreateCustomerDto {
  @ApiProperty()
  @IsUUID()
  company_id!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tax_number?: string;

  @ApiPropertyOptional({ example: "USD" })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @IsInt()
  @Min(0)
  payment_terms_days?: number;

  @ApiPropertyOptional({ description: "Decimal string, e.g. '10000.00'" })
  @IsOptional()
  @IsNumberString()
  credit_limit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  receivable_account_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address_line1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address_line2?: string;

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

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {}
