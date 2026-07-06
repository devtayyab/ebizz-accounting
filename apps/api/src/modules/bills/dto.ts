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

export class BillLineDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() item_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty() @IsNumberString() quantity!: string;
  @ApiProperty() @IsNumberString() unit_cost!: string;
  @ApiPropertyOptional({ description: "Tax fraction, e.g. 0.15" })
  @IsOptional() @IsNumberString() tax_rate?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() tax_rate_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() expense_account_id?: string;
}

export class CreateBillDto {
  @ApiProperty() @IsUUID() company_id!: string;
  @ApiProperty() @IsUUID() supplier_id!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() location_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bill_number?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() bill_date?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() due_date?: string;
  @ApiPropertyOptional({ example: "USD" }) @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() fx_rate?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() discount_total?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() shipping_total?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiProperty({ type: [BillLineDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => BillLineDto)
  lines!: BillLineDto[];
}

export class UpdateBillDto extends CreateBillDto {}
