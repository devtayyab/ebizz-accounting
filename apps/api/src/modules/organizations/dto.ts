import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, Length, Matches } from "class-validator";

/** Bootstraps a whole tenant: org + owner membership + first company + CoA. */
export class BootstrapOrgDto {
  @ApiProperty({ example: "Acme Trading" })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiProperty({ example: "acme-trading", description: "URL-safe unique slug" })
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: "slug must be lowercase alphanumeric with dashes" })
  @Length(1, 100)
  slug!: string;

  @ApiProperty({ example: "Acme Trading LLC" })
  @IsString()
  @Length(1, 200)
  company_name!: string;

  @ApiPropertyOptional({ example: "USD", default: "USD" })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  base_currency?: string;
}

export class CreateCompanyDto {
  @ApiProperty()
  @IsString()
  @Length(36, 36)
  organization_id!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  legal_name?: string;

  @ApiProperty({ example: "EUR" })
  @IsString()
  @Length(3, 3)
  base_currency!: string;

  @ApiPropertyOptional({ example: "DE" })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;
}

export class UpdateCompanyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) name?: string;
  @ApiPropertyOptional({ example: "AED" }) @IsOptional() @IsString() @Length(3, 3) base_currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() legal_name?: string;
  @ApiPropertyOptional({ example: "DE" }) @IsOptional() @IsString() @Length(2, 2) country?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address_line1?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() tax_number?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() invoice_terms?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() invoice_footer?: string;
  @ApiPropertyOptional({ description: "Data URL (max ~300KB) or https URL" })
  @IsOptional() @IsString() logo_url?: string;
}
