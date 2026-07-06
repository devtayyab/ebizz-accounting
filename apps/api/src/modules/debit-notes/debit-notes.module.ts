import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Injectable,
  Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Scope, UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsNumberString, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { SupabaseClient } from "@supabase/supabase-js";
import type { DebitNote } from "@ebizz/shared";
import { REQUEST_SUPABASE } from "../../supabase/supabase.module";
import { AuthGuard } from "../../auth/auth.guard";
import { CompanyId } from "../../common/company-id.decorator";
import { pgMessage } from "../../common/company.util";
import { computeLine, sum } from "../../common/money";
import { nextDocNumber } from "../../common/doc-number";

class NoteLineDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() item_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty() @IsNumberString() quantity!: string;
  @ApiProperty() @IsNumberString() unit_cost!: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() tax_rate?: string;
}
class CreateDebitNoteDto {
  @ApiProperty() @IsUUID() company_id!: string;
  @ApiProperty() @IsUUID() supplier_id!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() bill_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() location_id?: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() restock?: boolean;
  @ApiPropertyOptional({ example: "USD" }) @IsOptional() @IsString() currency?: string;
  @ApiPropertyOptional({ description: "1 doc currency = fx_rate base currency" }) @IsOptional() @IsNumberString() fx_rate?: string;
  @ApiProperty({ type: [NoteLineDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => NoteLineDto) lines!: NoteLineDto[];
}

@Injectable({ scope: Scope.REQUEST })
class DebitNotesService {
  constructor(@Inject(REQUEST_SUPABASE) private readonly db: SupabaseClient) {}

  private async company(companyId: string) {
    const { data, error } = await this.db.from("companies").select("organization_id, base_currency").eq("id", companyId).maybeSingle();
    if (error || !data) throw new NotFoundException("Company not accessible");
    return data as { organization_id: string; base_currency: string };
  }

  async list(companyId: string): Promise<DebitNote[]> {
    const { data, error } = await this.db.from("debit_notes").select("*").eq("company_id", companyId).order("note_date", { ascending: false });
    if (error) throw new BadRequestException(pgMessage(error));
    return (data ?? []) as DebitNote[];
  }

  async get(id: string): Promise<DebitNote> {
    const { data, error } = await this.db.from("debit_notes").select("*, lines:debit_note_lines(*)").eq("id", id).maybeSingle();
    if (error) throw new BadRequestException(pgMessage(error));
    if (!data) throw new NotFoundException("Debit note not found");
    return data as DebitNote;
  }

  async create(dto: CreateDebitNoteDto): Promise<DebitNote> {
    const { organization_id, base_currency } = await this.company(dto.company_id);
    const number = await nextDocNumber(this.db, "debit_notes", "note_number", dto.company_id, "DN-");
    const computed = dto.lines.map((l, i) => {
      const c = computeLine(Number(l.quantity), Number(l.unit_cost), Number(l.tax_rate ?? 0));
      return {
        organization_id, line_no: i + 1, item_id: l.item_id ?? null, description: l.description ?? null,
        quantity: l.quantity, unit_cost: l.unit_cost, tax_rate: l.tax_rate ?? "0",
        line_subtotal: c.line_subtotal, tax_amount: c.tax_amount, line_total: c.line_total,
      };
    });
    const subtotal = sum(computed.map((c) => c.line_subtotal));
    const tax_total = sum(computed.map((c) => c.tax_amount));
    const currency = dto.currency || base_currency;
    const fx_rate = currency === base_currency ? "1" : (dto.fx_rate && Number(dto.fx_rate) > 0 ? dto.fx_rate : "1");
    const { data: note, error } = await this.db.from("debit_notes").insert({
      organization_id, company_id: dto.company_id, supplier_id: dto.supplier_id,
      bill_id: dto.bill_id ?? null, location_id: dto.location_id ?? null,
      note_number: number, restock: dto.restock ?? true, currency, fx_rate,
      subtotal, tax_total, total: sum([subtotal, tax_total]),
    }).select("id").single();
    if (error) throw new BadRequestException(pgMessage(error));
    const noteId = (note as { id: string }).id;
    const { error: le } = await this.db.from("debit_note_lines").insert(computed.map((c) => ({ ...c, note_id: noteId })));
    if (le) throw new BadRequestException(pgMessage(le));
    return this.get(noteId);
  }

  async update(id: string, dto: CreateDebitNoteDto): Promise<DebitNote> {
    const existing = await this.get(id);
    if (existing.status !== "draft") throw new BadRequestException("Only draft debit notes can be edited");
    await this.db.from("debit_note_lines").delete().eq("note_id", id);
    const computed = dto.lines.map((l, i) => {
      const c = computeLine(Number(l.quantity), Number(l.unit_cost), Number(l.tax_rate ?? 0));
      return {
        organization_id: existing.organization_id, note_id: id, line_no: i + 1,
        item_id: l.item_id ?? null, description: l.description ?? null,
        quantity: l.quantity, unit_cost: l.unit_cost, tax_rate: l.tax_rate ?? "0",
        line_subtotal: c.line_subtotal, tax_amount: c.tax_amount, line_total: c.line_total,
      };
    });
    const subtotal = sum(computed.map((c) => c.line_subtotal));
    const tax_total = sum(computed.map((c) => c.tax_amount));
    const { base_currency } = await this.company(existing.company_id);
    const currency = dto.currency || base_currency;
    const fx_rate = currency === base_currency ? "1" : (dto.fx_rate && Number(dto.fx_rate) > 0 ? dto.fx_rate : "1");
    const { error } = await this.db.from("debit_notes").update({
      supplier_id: dto.supplier_id, bill_id: dto.bill_id ?? null, location_id: dto.location_id ?? null,
      restock: dto.restock ?? true, currency, fx_rate, subtotal, tax_total, total: sum([subtotal, tax_total]),
    }).eq("id", id);
    if (error) throw new BadRequestException(pgMessage(error));
    const { error: le } = await this.db.from("debit_note_lines").insert(computed);
    if (le) throw new BadRequestException(pgMessage(le));
    return this.get(id);
  }

  async post(id: string): Promise<DebitNote> {
    const { error } = await this.db.rpc("post_debit_note", { p_id: id });
    if (error) throw new BadRequestException(pgMessage(error));
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db.from("debit_notes").delete().eq("id", id).eq("status", "draft");
    if (error) throw new BadRequestException(pgMessage(error));
  }
}

@ApiTags("debit-notes")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("debit-notes")
class DebitNotesController {
  constructor(private readonly svc: DebitNotesService) {}
  @Get() list(@CompanyId() c: string) { return this.svc.list(c); }
  @Get(":id") get(@Param("id", ParseUUIDPipe) id: string) { return this.svc.get(id); }
  @Post() create(@Body() dto: CreateDebitNoteDto) { return this.svc.create(dto); }
  @Patch(":id") update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: CreateDebitNoteDto) { return this.svc.update(id, dto); }
  @Post(":id/post") post(@Param("id", ParseUUIDPipe) id: string) { return this.svc.post(id); }
  @Delete(":id") @HttpCode(204) remove(@Param("id", ParseUUIDPipe) id: string) { return this.svc.remove(id); }
}

@Module({ controllers: [DebitNotesController], providers: [DebitNotesService, AuthGuard] })
export class DebitNotesModule {}
