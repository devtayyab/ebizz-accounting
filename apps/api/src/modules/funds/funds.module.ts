import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Injectable,
  Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Scope, UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { IsBoolean, IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, Length } from "class-validator";
import { SupabaseClient } from "@supabase/supabase-js";
import { REQUEST_SUPABASE } from "../../supabase/supabase.module";
import { AuthGuard } from "../../auth/auth.guard";
import { CompanyId } from "../../common/company-id.decorator";
import { pgMessage, resolveOrganizationId } from "../../common/company.util";

const TX_TYPES = ["deposit", "payment", "receipt", "adjustment"] as const;

class CreateFundDto {
  @ApiProperty() @IsUUID() company_id!: string;
  @ApiProperty() @IsString() @Length(1, 200) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_active?: boolean;
}
class UpdateFundDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_active?: boolean;
}
class FundTxDto {
  @ApiProperty({ enum: TX_TYPES }) @IsIn(TX_TYPES) entry_type!: (typeof TX_TYPES)[number];
  @ApiProperty({ description: "Positive amount; adjustments may be signed" }) @IsNumberString() amount!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() txn_date?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplier_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customer_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() counterparty?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() memo?: string;
  @ApiPropertyOptional({ example: "USD" }) @IsOptional() @IsString() currency?: string;
  @ApiPropertyOptional({ description: "1 doc currency = fx_rate base currency" }) @IsOptional() @IsNumberString() fx_rate?: string;
}

/** deposit/receipt add to the balance; payment subtracts; adjustment is signed. */
function effect(type: string, amount: number): number {
  if (type === "payment") return -Math.abs(amount);
  if (type === "adjustment") return amount;
  return Math.abs(amount);
}

/** Supabase types a to-one embed as an array; normalise to the base_currency string. */
function baseCurrencyOf(company: unknown): string | undefined {
  const c = Array.isArray(company) ? company[0] : company;
  return (c as { base_currency?: string } | null | undefined)?.base_currency;
}

/** Resolve the stored currency + fx_rate: base currency always uses rate 1. */
function normalizeFx(dto: { currency?: string; fx_rate?: string }, base?: string): { currency: string | null; fx_rate: string } {
  const currency = dto.currency || base || null;
  if (!currency || currency === base) return { currency, fx_rate: "1" };
  const rate = dto.fx_rate && Number(dto.fx_rate) > 0 ? dto.fx_rate : "1";
  return { currency, fx_rate: rate };
}

@Injectable({ scope: Scope.REQUEST })
class FundsService {
  constructor(@Inject(REQUEST_SUPABASE) private readonly db: SupabaseClient) {}

  async list(companyId: string) {
    const { data: accounts, error } = await this.db
      .from("fund_accounts").select("*").eq("company_id", companyId).order("name");
    if (error) throw new BadRequestException(pgMessage(error));
    const { data: txs, error: e2 } = await this.db
      .from("fund_transactions").select("fund_account_id, entry_type, amount, fx_rate").eq("company_id", companyId);
    if (e2) throw new BadRequestException(pgMessage(e2));
    const balances = new Map<string, number>();
    // Balances are consolidated to the company base currency (amount × fx_rate).
    for (const t of (txs ?? []) as { fund_account_id: string; entry_type: string; amount: string; fx_rate: string | null }[]) {
      const base = Number(t.amount) * (Number(t.fx_rate) || 1);
      balances.set(t.fund_account_id, (balances.get(t.fund_account_id) ?? 0) + effect(t.entry_type, base));
    }
    return (accounts ?? []).map((a: Record<string, unknown>) => ({
      ...a,
      balance: Math.round(((balances.get(a.id as string) ?? 0) + Number.EPSILON) * 100) / 100,
    }));
  }

  async create(dto: CreateFundDto) {
    const organization_id = await resolveOrganizationId(this.db, dto.company_id);
    const { data, error } = await this.db
      .from("fund_accounts").insert({ ...dto, organization_id }).select("*").single();
    if (error) throw new BadRequestException(pgMessage(error));
    return data;
  }

  async update(id: string, dto: UpdateFundDto) {
    const { data, error } = await this.db
      .from("fund_accounts").update(dto).eq("id", id).select("*").maybeSingle();
    if (error) throw new BadRequestException(pgMessage(error));
    if (!data) throw new NotFoundException("Fund account not found");
    return data;
  }

  async remove(id: string) {
    const { error } = await this.db.from("fund_accounts").delete().eq("id", id);
    if (error) throw new BadRequestException(pgMessage(error));
  }

  async transactions(fundId: string) {
    const { data, error } = await this.db
      .from("fund_transactions").select("*").eq("fund_account_id", fundId)
      .order("txn_date", { ascending: false }).order("created_at", { ascending: false });
    if (error) throw new BadRequestException(pgMessage(error));
    return data ?? [];
  }

  async addTx(fundId: string, dto: FundTxDto) {
    const { data: fund, error: fe } = await this.db
      .from("fund_accounts").select("organization_id, company_id, company:companies(base_currency)").eq("id", fundId).maybeSingle();
    if (fe || !fund) throw new NotFoundException("Fund account not found");
    const f = fund as { organization_id: string; company_id: string; company: unknown };
    const { currency, fx_rate } = normalizeFx(dto, baseCurrencyOf(f.company));
    const { data, error } = await this.db.from("fund_transactions").insert({
      organization_id: f.organization_id, company_id: f.company_id, fund_account_id: fundId,
      txn_date: dto.txn_date ?? new Date().toISOString().slice(0, 10),
      entry_type: dto.entry_type, amount: dto.amount, currency, fx_rate,
      supplier_id: dto.supplier_id ?? null, customer_id: dto.customer_id ?? null,
      counterparty: dto.counterparty ?? null, reference: dto.reference ?? null, memo: dto.memo ?? null,
    }).select("*").single();
    if (error) throw new BadRequestException(pgMessage(error));
    return data;
  }

  async updateTx(txId: string, dto: FundTxDto) {
    const { data: existing } = await this.db.from("fund_transactions")
      .select("company:companies(base_currency)").eq("id", txId).maybeSingle();
    const base = baseCurrencyOf((existing as { company: unknown } | null)?.company);
    const { currency, fx_rate } = normalizeFx(dto, base);
    const { data, error } = await this.db.from("fund_transactions").update({
      entry_type: dto.entry_type, amount: dto.amount, currency, fx_rate,
      txn_date: dto.txn_date ?? undefined,
      supplier_id: dto.supplier_id ?? null, customer_id: dto.customer_id ?? null,
      counterparty: dto.counterparty ?? null, reference: dto.reference ?? null, memo: dto.memo ?? null,
    }).eq("id", txId).select("*").maybeSingle();
    if (error) throw new BadRequestException(pgMessage(error));
    if (!data) throw new NotFoundException("Transaction not found");
    return data;
  }

  async removeTx(txId: string) {
    const { error } = await this.db.from("fund_transactions").delete().eq("id", txId);
    if (error) throw new BadRequestException(pgMessage(error));
  }
}

@ApiTags("funds")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("funds")
class FundsController {
  constructor(private readonly svc: FundsService) {}
  @Get() list(@CompanyId() c: string) { return this.svc.list(c); }
  @Post() create(@Body() dto: CreateFundDto) { return this.svc.create(dto); }
  @Patch(":id") update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateFundDto) { return this.svc.update(id, dto); }
  @Delete(":id") @HttpCode(204) remove(@Param("id", ParseUUIDPipe) id: string) { return this.svc.remove(id); }
  @Get(":id/transactions") txs(@Param("id", ParseUUIDPipe) id: string) { return this.svc.transactions(id); }
  @Post(":id/transactions") addTx(@Param("id", ParseUUIDPipe) id: string, @Body() dto: FundTxDto) { return this.svc.addTx(id, dto); }
  @Patch("transactions/:txId") updateTx(@Param("txId", ParseUUIDPipe) txId: string, @Body() dto: FundTxDto) { return this.svc.updateTx(txId, dto); }
  @Delete("transactions/:txId") @HttpCode(204) removeTx(@Param("txId", ParseUUIDPipe) txId: string) { return this.svc.removeTx(txId); }
}

@Module({ controllers: [FundsController], providers: [FundsService, AuthGuard] })
export class FundsModule {}
