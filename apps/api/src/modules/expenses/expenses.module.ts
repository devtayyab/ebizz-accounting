import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Module,
  NotFoundException, Param, ParseUUIDPipe, Patch, Post, Scope, UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { IsDateString, IsNumberString, IsOptional, IsString, IsUUID } from "class-validator";
import { SupabaseClient } from "@supabase/supabase-js";
import type { Expense } from "@ebizz/shared";
import { REQUEST_SUPABASE } from "../../supabase/supabase.module";
import { AuthGuard } from "../../auth/auth.guard";
import { CompanyId } from "../../common/company-id.decorator";
import { pgMessage } from "../../common/company.util";

class CreateExpenseDto {
  @ApiProperty() @IsUUID() company_id!: string;
  @ApiProperty({ description: "An expense-type account (category)" }) @IsUUID() category_account_id!: string;
  @ApiProperty() @IsNumberString() amount!: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() tax_amount?: string;
  @ApiPropertyOptional({ description: "Cash/bank account paid from. Omit to record as payable." })
  @IsOptional() @IsUUID() paid_account_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplier_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expense_date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() memo?: string;
  @ApiPropertyOptional({ example: "USD" }) @IsOptional() @IsString() currency?: string;
  @ApiPropertyOptional({ description: "1 doc currency = fx_rate base currency" }) @IsOptional() @IsNumberString() fx_rate?: string;
}

/** Edit an existing expense — same fields as create minus company_id (fixed). */
class UpdateExpenseDto {
  @ApiProperty({ description: "An expense-type account (category)" }) @IsUUID() category_account_id!: string;
  @ApiProperty() @IsNumberString() amount!: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() tax_amount?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() paid_account_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplier_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expense_date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() memo?: string;
  @ApiPropertyOptional({ example: "USD" }) @IsOptional() @IsString() currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() fx_rate?: string;
}

@Injectable({ scope: Scope.REQUEST })
class ExpensesService {
  constructor(@Inject(REQUEST_SUPABASE) private readonly db: SupabaseClient) {}

  async list(companyId: string): Promise<Expense[]> {
    const { data, error } = await this.db
      .from("expenses").select("*").eq("company_id", companyId).order("expense_date", { ascending: false });
    if (error) throw new BadRequestException(pgMessage(error));
    return (data ?? []) as Expense[];
  }

  async get(id: string): Promise<Expense> {
    const { data, error } = await this.db.from("expenses").select("*").eq("id", id).maybeSingle();
    if (error) throw new BadRequestException(pgMessage(error));
    if (!data) throw new NotFoundException("Expense not found");
    return data as Expense;
  }

  async create(dto: CreateExpenseDto): Promise<Expense> {
    const { data: expenseId, error } = await this.db.rpc("record_expense", {
      p_company: dto.company_id,
      p_date: dto.expense_date ?? new Date().toISOString().slice(0, 10),
      p_category_account: dto.category_account_id,
      p_amount: Number(dto.amount),
      p_tax_amount: dto.tax_amount ? Number(dto.tax_amount) : 0,
      p_paid_account: dto.paid_account_id ?? null,
      p_supplier: dto.supplier_id ?? null,
      p_reference: dto.reference ?? null,
      p_memo: dto.memo ?? null,
      p_currency: dto.currency ?? null,
      p_fx_rate: dto.fx_rate ? Number(dto.fx_rate) : 1,
    });
    if (error) throw new BadRequestException(pgMessage(error));
    return this.get(expenseId as string);
  }

  /** Edit: reverses the old journal entry and posts a fresh one (revise_expense). */
  async update(id: string, dto: UpdateExpenseDto): Promise<Expense> {
    const { error } = await this.db.rpc("revise_expense", {
      p_id: id,
      p_date: dto.expense_date ?? new Date().toISOString().slice(0, 10),
      p_category_account: dto.category_account_id,
      p_amount: Number(dto.amount),
      p_tax_amount: dto.tax_amount ? Number(dto.tax_amount) : 0,
      p_paid_account: dto.paid_account_id ?? null,
      p_supplier: dto.supplier_id ?? null,
      p_reference: dto.reference ?? null,
      p_memo: dto.memo ?? null,
      p_currency: dto.currency ?? null,
      p_fx_rate: dto.fx_rate ? Number(dto.fx_rate) : 1,
    });
    if (error) throw new BadRequestException(pgMessage(error));
    return this.get(id);
  }

  /** Un-pay a paid expense: posts Dr cash / Cr A/P and flips it to unpaid. */
  async reversePayment(id: string): Promise<Expense> {
    const { error } = await this.db.rpc("reverse_expense_payment", { p_id: id });
    if (error) throw new BadRequestException(pgMessage(error));
    return this.get(id);
  }

  /** Delete: neutralise the ledger (mirror the JE) then remove the row. */
  async remove(id: string): Promise<void> {
    const { data: exp, error: getErr } = await this.db
      .from("expenses").select("id").eq("id", id).maybeSingle();
    if (getErr) throw new BadRequestException(pgMessage(getErr));
    if (!exp) throw new NotFoundException("Expense not found");
    const { error: revErr } = await this.db.rpc("reverse_expense", { p_id: id });
    if (revErr) throw new BadRequestException(pgMessage(revErr));
    const { error } = await this.db.from("expenses").delete().eq("id", id);
    if (error) throw new BadRequestException(pgMessage(error));
  }
}

@ApiTags("expenses")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("expenses")
class ExpensesController {
  constructor(private readonly svc: ExpensesService) {}
  @Get() list(@CompanyId() c: string) { return this.svc.list(c); }
  @Get(":id") get(@Param("id", ParseUUIDPipe) id: string) { return this.svc.get(id); }
  @Post() create(@Body() dto: CreateExpenseDto) { return this.svc.create(dto); }
  @Patch(":id") update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateExpenseDto) { return this.svc.update(id, dto); }
  @Post(":id/reverse-payment") reversePayment(@Param("id", ParseUUIDPipe) id: string) { return this.svc.reversePayment(id); }
  @Delete(":id") @HttpCode(204) remove(@Param("id", ParseUUIDPipe) id: string) { return this.svc.remove(id); }
}

@Module({ controllers: [ExpensesController], providers: [ExpensesService, AuthGuard] })
export class ExpensesModule {}
