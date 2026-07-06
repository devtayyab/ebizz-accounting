import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Scope,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { IsBoolean, IsNumberString, IsOptional, IsString, IsUUID, Length } from "class-validator";
import { SupabaseClient } from "@supabase/supabase-js";
import type { TaxRate } from "@ebizz/shared";
import { REQUEST_SUPABASE } from "../../supabase/supabase.module";
import { AuthGuard } from "../../auth/auth.guard";
import { CompanyId } from "../../common/company-id.decorator";
import { pgMessage, resolveOrganizationId } from "../../common/company.util";

class CreateTaxRateDto {
  @ApiProperty() @IsUUID() company_id!: string;
  @ApiProperty() @IsString() @Length(1, 100) name!: string;
  @ApiProperty({ description: "Fraction, e.g. 0.15 for 15%" }) @IsNumberString() rate!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() is_active?: boolean;
}

class UpdateTaxRateDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() rate?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_active?: boolean;
}

@Injectable({ scope: Scope.REQUEST })
class TaxRatesService {
  constructor(@Inject(REQUEST_SUPABASE) private readonly db: SupabaseClient) {}

  async list(companyId: string): Promise<TaxRate[]> {
    const { data, error } = await this.db
      .from("tax_rates")
      .select("*")
      .eq("company_id", companyId)
      .order("name");
    if (error) throw new BadRequestException(pgMessage(error));
    return (data ?? []) as TaxRate[];
  }

  async create(dto: CreateTaxRateDto): Promise<TaxRate> {
    const organization_id = await resolveOrganizationId(this.db, dto.company_id);
    const { data, error } = await this.db
      .from("tax_rates")
      .insert({ ...dto, organization_id })
      .select("*")
      .single();
    if (error) throw new BadRequestException(pgMessage(error));
    return data as TaxRate;
  }

  async update(id: string, dto: UpdateTaxRateDto): Promise<TaxRate> {
    const { data, error } = await this.db
      .from("tax_rates")
      .update(dto)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new BadRequestException(pgMessage(error));
    if (!data) throw new NotFoundException(`Tax rate ${id} not found`);
    return data as TaxRate;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db.from("tax_rates").delete().eq("id", id);
    if (error) {
      throw new BadRequestException(
        "This tax rate can't be deleted because it's used on documents. Deactivate it instead.",
      );
    }
  }
}

@ApiTags("tax-rates")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("tax-rates")
class TaxRatesController {
  constructor(private readonly svc: TaxRatesService) {}

  @Get()
  list(@CompanyId() companyId: string) {
    return this.svc.list(companyId);
  }

  @Post()
  create(@Body() dto: CreateTaxRateDto) {
    return this.svc.create(dto);
  }

  @Patch(":id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateTaxRateDto) {
    return this.svc.update(id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.remove(id);
  }
}

@Module({
  controllers: [TaxRatesController],
  providers: [TaxRatesService, AuthGuard],
})
export class TaxRatesModule {}
