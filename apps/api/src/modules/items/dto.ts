import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from "class-validator";
import { INVENTORY_MOVEMENT_TYPES, ITEM_TYPES } from "@ebizz/shared";

export class CreateItemDto {
  @ApiProperty()
  @IsUUID()
  company_id!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 100)
  sku!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: ITEM_TYPES, default: "inventory" })
  @IsOptional()
  @IsIn(ITEM_TYPES)
  type?: (typeof ITEM_TYPES)[number];

  @ApiPropertyOptional({ default: "unit" })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @ApiProperty({ description: "Decimal string — required for all items" })
  @IsNumberString()
  purchase_price!: string;

  @ApiPropertyOptional({ description: "Decimal string" })
  @IsOptional()
  @IsNumberString()
  sale_price?: string;

  @ApiPropertyOptional({ example: "USD" })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  track_inventory?: boolean;

  @ApiPropertyOptional({ description: "Decimal string" })
  @IsOptional()
  @IsNumberString()
  reorder_point?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  income_account_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  expense_account_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  inventory_account_id?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateItemDto extends PartialType(CreateItemDto) {}

/** Attach / update a supplier as a source for an item. */
export class LinkSupplierDto {
  @ApiProperty()
  @IsUUID()
  supplier_id!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  supplier_sku?: string;

  @ApiPropertyOptional({ description: "Decimal string" })
  @IsOptional()
  @IsNumberString()
  cost?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  lead_time_days?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  is_preferred?: boolean;
}

/** Record a stock movement; the DB posts the matching journal entry. */
export class MovementDto {
  @ApiProperty()
  @IsUUID()
  location_id!: string;

  @ApiProperty({ enum: INVENTORY_MOVEMENT_TYPES })
  @IsIn(INVENTORY_MOVEMENT_TYPES)
  movement_type!: (typeof INVENTORY_MOVEMENT_TYPES)[number];

  @ApiProperty({ description: "Signed decimal string: +receipt, -issue" })
  @IsNumberString()
  quantity!: string;

  @ApiPropertyOptional({ description: "Unit cost for receipts (decimal string)" })
  @IsOptional()
  @IsNumberString()
  unit_cost?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  supplier_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @ApiPropertyOptional({ default: true, description: "Post a journal entry too" })
  @IsOptional()
  @IsBoolean()
  post_to_ledger?: boolean;
}

/** Move stock between two locations (no ledger impact). */
export class TransferDto {
  @ApiProperty() @IsUUID() from_location_id!: string;
  @ApiProperty() @IsUUID() to_location_id!: string;
  @ApiProperty({ description: "Positive quantity to move" }) @IsNumberString() quantity!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reference?: string;
}

/** Adjust stock at a location (posts to Inventory Adjustments). */
export class AdjustDto {
  @ApiProperty() @IsUUID() location_id!: string;
  @ApiProperty({ description: "Signed delta: + found, - write-off" }) @IsNumberString() quantity_delta!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
  @ApiPropertyOptional({ description: "Unit cost (defaults to current avg cost)" })
  @IsOptional() @IsNumberString() unit_cost?: string;
}
