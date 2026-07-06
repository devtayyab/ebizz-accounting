import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsDateString,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from "class-validator";

export class InvoiceLineDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() item_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty() @IsNumberString() quantity!: string;
  @ApiProperty() @IsNumberString() unit_price!: string;
  @ApiPropertyOptional({ description: "Tax fraction, e.g. 0.15" })
  @IsOptional() @IsNumberString() tax_rate?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() tax_rate_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() income_account_id?: string;
}

export class CreateInvoiceDto {
  @ApiProperty() @IsUUID() company_id!: string;
  @ApiProperty() @IsUUID() customer_id!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() location_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() invoice_number?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() invoice_date?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() due_date?: string;
  @ApiPropertyOptional({ example: "USD" }) @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() fx_rate?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() discount_total?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() shipping_total?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() terms?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() ship_to_name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() ship_to_address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() ship_to_city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() ship_to_country?: string;
  @ApiProperty({ type: [InvoiceLineDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => InvoiceLineDto)
  lines!: InvoiceLineDto[];
}

export class UpdateInvoiceDto extends CreateInvoiceDto {}
