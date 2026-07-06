import {
  BadRequestException, Body, Controller, Get, Inject, Injectable, Module,
  NotFoundException, Post, Scope, UseGuards,
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

@Injectable({ scope: Scope.REQUEST })
class ExpensesService {
  constructor(@Inject(REQUEST_SUPABASE) private readonly db: SupabaseClient) {}

  async list(companyId: string): Promise<Expense[]> {
    const { data, error } = await this.db
      .from("expenses").select("*").eq("company_id", companyId).order("expense_date", { ascending: false });
    if (error) throw new BadRequestException(pgMessage(error));
    return (data ?? []) as Expense[];
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
    const { data, error: getErr } = await this.db.from("expenses").select("*").eq("id", expenseId as string).maybeSingle();
    if (getErr) throw new BadRequestException(pgMessage(getErr));
    if (!data) throw new NotFoundException("Expense not found after creation");
    return data as Expense;
  }
}

@ApiTags("expenses")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("expenses")
class ExpensesController {
  constructor(private readonly svc: ExpensesService) {}
  @Get() list(@CompanyId() c: string) { return this.svc.list(c); }
  @Post() create(@Body() dto: CreateExpenseDto) { return this.svc.create(dto); }
}

@Module({ controllers: [ExpensesController], providers: [ExpensesService, AuthGuard] })
export class ExpensesModule {}
