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
  Post,
  Query,
  Scope,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray, IsDateString, IsNumberString, IsOptional, IsString, IsUUID, ValidateNested,
} from "class-validator";
import { SupabaseClient } from "@supabase/supabase-js";
import type { JournalEntry } from "@ebizz/shared";
import { REQUEST_SUPABASE } from "../../supabase/supabase.module";
import { AuthGuard } from "../../auth/auth.guard";
import { CompanyId } from "../../common/company-id.decorator";
import { pgMessage } from "../../common/company.util";

class JournalLineDto {
  @ApiProperty() @IsUUID() account_id!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ default: "0" }) @IsOptional() @IsNumberString() debit?: string;
  @ApiPropertyOptional({ default: "0" }) @IsOptional() @IsNumberString() credit?: string;
}

class CreateJournalDto {
  @ApiProperty() @IsUUID() company_id!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() entry_date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() memo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reference?: string;
  @ApiProperty({ type: [JournalLineDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => JournalLineDto)
  lines!: JournalLineDto[];
}

@Injectable({ scope: Scope.REQUEST })
class JournalEntriesService {
  constructor(@Inject(REQUEST_SUPABASE) private readonly db: SupabaseClient) {}

  private async company(companyId: string) {
    const { data, error } = await this.db
      .from("companies").select("organization_id, base_currency").eq("id", companyId).maybeSingle();
    if (error || !data) throw new NotFoundException(`Company ${companyId} not accessible`);
    return data as { organization_id: string; base_currency: string };
  }

  async list(companyId: string): Promise<JournalEntry[]> {
    const { data, error } = await this.db
      .from("journal_entries").select("*").eq("company_id", companyId)
      .order("entry_date", { ascending: false }).limit(200);
    if (error) throw new BadRequestException(pgMessage(error));
    return (data ?? []) as JournalEntry[];
  }

  async get(id: string): Promise<JournalEntry> {
    const { data, error } = await this.db
      .from("journal_entries").select("*, lines:journal_lines(*)").eq("id", id).maybeSingle();
    if (error) throw new BadRequestException(pgMessage(error));
    if (!data) throw new NotFoundException(`Journal entry ${id} not found`);
    return data as JournalEntry;
  }

  async create(dto: CreateJournalDto, post: boolean): Promise<JournalEntry> {
    const { organization_id, base_currency } = await this.company(dto.company_id);
    const totalDebit = dto.lines.reduce((a, l) => a + Number(l.debit ?? 0), 0);
    const totalCredit = dto.lines.reduce((a, l) => a + Number(l.credit ?? 0), 0);
    if (post && Math.abs(totalDebit - totalCredit) > 0.005) {
      throw new BadRequestException(`Entry is unbalanced: debits ${totalDebit} vs credits ${totalCredit}`);
    }
    const { data: entry, error } = await this.db
      .from("journal_entries")
      .insert({
        organization_id, company_id: dto.company_id,
        entry_date: dto.entry_date ?? new Date().toISOString().slice(0, 10),
        memo: dto.memo ?? null, reference: dto.reference ?? null,
        status: "draft", source_type: "manual",
      })
      .select("id").single();
    if (error) throw new BadRequestException(pgMessage(error));
    const entryId = (entry as { id: string }).id;

    const lines = dto.lines
      .filter((l) => Number(l.debit ?? 0) > 0 || Number(l.credit ?? 0) > 0)
      .map((l) => ({
        organization_id, journal_entry_id: entryId, account_id: l.account_id,
        description: l.description ?? null, currency: base_currency,
        debit: l.debit ?? 0, credit: l.credit ?? 0,
        base_debit: l.debit ?? 0, base_credit: l.credit ?? 0,
      }));
    const { error: lineErr } = await this.db.from("journal_lines").insert(lines);
    if (lineErr) throw new BadRequestException(pgMessage(lineErr));

    if (post) {
      const { error: postErr } = await this.db
        .from("journal_entries").update({ status: "posted" }).eq("id", entryId);
      if (postErr) throw new BadRequestException(pgMessage(postErr));
    }
    return this.get(entryId);
  }

  async post(id: string): Promise<JournalEntry> {
    const { error } = await this.db.from("journal_entries").update({ status: "posted" }).eq("id", id);
    if (error) throw new BadRequestException(pgMessage(error));
    return this.get(id);
  }

  /** Post a reversing (mirror) entry for a posted manual journal entry. */
  async reverse(id: string): Promise<JournalEntry> {
    const { data, error } = await this.db.rpc("reverse_journal_entry", { p_id: id });
    if (error) throw new BadRequestException(pgMessage(error));
    return this.get(data as string);
  }

  async remove(id: string): Promise<void> {
    const entry = await this.get(id);
    if (entry.status === "posted") {
      throw new BadRequestException("Posted entries can't be deleted — use Reverse to cancel their effect.");
    }
    const { error } = await this.db.from("journal_entries").delete().eq("id", id);
    if (error) throw new BadRequestException(pgMessage(error));
  }
}

@ApiTags("journal-entries")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("journal-entries")
class JournalEntriesController {
  constructor(private readonly svc: JournalEntriesService) {}

  @Get()
  list(@CompanyId() companyId: string) { return this.svc.list(companyId); }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string) { return this.svc.get(id); }

  @Post()
  create(@Body() dto: CreateJournalDto, @Query("post") post?: string) {
    return this.svc.create(dto, post === "true");
  }

  @Post(":id/post")
  post(@Param("id", ParseUUIDPipe) id: string) { return this.svc.post(id); }

  @Post(":id/reverse")
  reverse(@Param("id", ParseUUIDPipe) id: string) { return this.svc.reverse(id); }

  @Delete(":id")
  @HttpCode(204)
  remove(@Param("id", ParseUUIDPipe) id: string) { return this.svc.remove(id); }
}

@Module({
  controllers: [JournalEntriesController],
  providers: [JournalEntriesService, AuthGuard],
})
export class JournalEntriesModule {}
