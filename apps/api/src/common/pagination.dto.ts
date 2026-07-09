import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { Type } from "class-transformer";

/** Shared list query: pagination + free-text search. */
export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  page_size = 25;

  @ApiPropertyOptional({ description: "Case-insensitive search on name/sku" })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: "Column to sort by (whitelisted per module)" })
  @IsOptional()
  @IsString()
  sort?: string;

  @ApiPropertyOptional({ description: "Sort direction", enum: ["asc", "desc"] })
  @IsOptional()
  @IsIn(["asc", "desc"])
  dir?: "asc" | "desc";
}

/** Converts a 1-based page into a Postgres range [from, to]. */
export function toRange(page: number, pageSize: number): [number, number] {
  const from = (page - 1) * pageSize;
  return [from, from + pageSize - 1];
}
