import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  Query,
  Scope,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SupabaseClient } from "@supabase/supabase-js";
import type {
  AgingRow,
  BalanceSheet,
  ProfitAndLoss,
  TrialBalanceRow,
} from "@ebizz/shared";
import { REQUEST_SUPABASE } from "../../supabase/supabase.module";
import { AuthGuard } from "../../auth/auth.guard";
import { CompanyId } from "../../common/company-id.decorator";
import { pgMessage } from "../../common/company.util";
import { round2 } from "../../common/money";

interface ActivityRow {
  account_id: string;
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  debit: string;
  credit: string;
  balance: string;
}

@Injectable({ scope: Scope.REQUEST })
class ReportsService {
  constructor(@Inject(REQUEST_SUPABASE) private readonly db: SupabaseClient) {}

  private async activity(companyId: string, from?: string, to?: string): Promise<ActivityRow[]> {
    const { data, error } = await this.db.rpc("report_account_activity", {
      p_company: companyId,
      p_from: from ?? null,
      p_to: to ?? null,
    });
    if (error) throw new BadRequestException(pgMessage(error));
    return (data ?? []) as ActivityRow[];
  }

  async trialBalance(companyId: string, from?: string, to?: string): Promise<TrialBalanceRow[]> {
    const rows = await this.activity(companyId, from, to);
    return rows
      .filter((r) => Number(r.debit) !== 0 || Number(r.credit) !== 0)
      .map((r) => {
        const bal = Number(r.balance);
        return {
          account_id: r.account_id,
          code: r.code,
          name: r.name,
          type: r.type,
          debit: String(bal >= 0 ? round2(bal) : 0),
          credit: String(bal < 0 ? round2(-bal) : 0),
        };
      });
  }

  async profitAndLoss(companyId: string, from?: string, to?: string): Promise<ProfitAndLoss> {
    const rows = await this.activity(companyId, from, to);
    const income = rows
      .filter((r) => r.type === "income" && Number(r.balance) !== 0)
      .map((r) => ({ account_id: r.account_id, code: r.code, name: r.name, type: r.type, amount: String(round2(-Number(r.balance))) }));
    const expenses = rows
      .filter((r) => r.type === "expense" && Number(r.balance) !== 0)
      .map((r) => ({ account_id: r.account_id, code: r.code, name: r.name, type: r.type, amount: String(round2(Number(r.balance))) }));
    const total_income = round2(income.reduce((a, r) => a + Number(r.amount), 0));
    const total_expenses = round2(expenses.reduce((a, r) => a + Number(r.amount), 0));
    return {
      income,
      expenses,
      total_income: String(total_income),
      total_expenses: String(total_expenses),
      net_profit: String(round2(total_income - total_expenses)),
    };
  }

  async balanceSheet(companyId: string, asOf?: string): Promise<BalanceSheet> {
    const rows = await this.activity(companyId, undefined, asOf);
    const section = (type: string, sign: 1 | -1) =>
      rows
        .filter((r) => r.type === type && Number(r.balance) !== 0)
        .map((r) => ({ account_id: r.account_id, code: r.code, name: r.name, type: r.type as never, amount: String(round2(sign * Number(r.balance))) }));

    const assets = section("asset", 1);
    const liabilities = section("liability", -1);
    const equity = section("equity", -1);
    // Undistributed profit rolls into equity on the balance sheet.
    const retained_earnings = round2(
      rows
        .filter((r) => r.type === "income")
        .reduce((a, r) => a - Number(r.balance), 0) -
        rows.filter((r) => r.type === "expense").reduce((a, r) => a + Number(r.balance), 0),
    );
    const total_assets = round2(assets.reduce((a, r) => a + Number(r.amount), 0));
    const total_liabilities = round2(liabilities.reduce((a, r) => a + Number(r.amount), 0));
    const total_equity = round2(equity.reduce((a, r) => a + Number(r.amount), 0) + retained_earnings);
    return {
      assets,
      liabilities,
      equity,
      total_assets: String(total_assets),
      total_liabilities: String(total_liabilities),
      total_equity: String(total_equity),
      retained_earnings: String(retained_earnings),
    };
  }

  async generalLedger(companyId: string, account?: string, from?: string, to?: string) {
    const { data, error } = await this.db.rpc("report_general_ledger", {
      p_company: companyId, p_account: account ?? null, p_from: from ?? null, p_to: to ?? null,
    });
    if (error) throw new BadRequestException(pgMessage(error));
    return data ?? [];
  }

  async inventoryValuation(companyId: string) {
    const { data, error } = await this.db.rpc("report_inventory_valuation", { p_company: companyId });
    if (error) throw new BadRequestException(pgMessage(error));
    return data ?? [];
  }

  async lowStock(companyId: string) {
    const { data, error } = await this.db.rpc("report_low_stock", { p_company: companyId });
    if (error) throw new BadRequestException(pgMessage(error));
    return data ?? [];
  }

  async statement(companyId: string, kind: "customer" | "supplier", partyId?: string) {
    const fn = kind === "customer" ? "report_customer_statement" : "report_supplier_statement";
    const params = kind === "customer"
      ? { p_company: companyId, p_customer: partyId ?? null }
      : { p_company: companyId, p_supplier: partyId ?? null };
    const { data, error } = await this.db.rpc(fn, params);
    if (error) throw new BadRequestException(pgMessage(error));
    return data ?? [];
  }

  /** Most recent documents across invoices/bills/payments/expenses for the dashboard feed. */
  async recentActivity(companyId: string) {
    const [inv, bill, pay, exp] = await Promise.all([
      this.db.from("sales_invoices").select("id, invoice_number, total, currency, created_at").eq("company_id", companyId).is("deleted_at", null).order("created_at", { ascending: false }).limit(8),
      this.db.from("purchase_bills").select("id, bill_number, total, currency, created_at").eq("company_id", companyId).is("deleted_at", null).order("created_at", { ascending: false }).limit(8),
      this.db.from("payments").select("id, amount, currency, party_type, created_at").eq("company_id", companyId).order("created_at", { ascending: false }).limit(8),
      this.db.from("expenses").select("id, memo, total, currency, created_at").eq("company_id", companyId).is("deleted_at", null).order("created_at", { ascending: false }).limit(8),
    ]);
    for (const r of [inv, bill, pay, exp]) if (r.error) throw new BadRequestException(pgMessage(r.error));
    type Row = { type: string; label: string; sub: string; amount: string; currency: string; created_at: string; link?: string };
    const rows: Row[] = [];
    for (const r of (inv.data ?? []) as Record<string, string>[])
      rows.push({ type: "invoice", label: r.invoice_number, sub: "Sales invoice", amount: r.total, currency: r.currency, created_at: r.created_at, link: `/invoices/${r.id}/print` });
    for (const r of (bill.data ?? []) as Record<string, string>[])
      rows.push({ type: "bill", label: r.bill_number, sub: "Purchase bill", amount: r.total, currency: r.currency, created_at: r.created_at, link: `/bills/${r.id}/print` });
    for (const r of (pay.data ?? []) as Record<string, string>[])
      rows.push({ type: "payment", label: r.party_type === "supplier" ? "Payment sent" : "Payment received", sub: "Payment", amount: r.amount, currency: r.currency, created_at: r.created_at });
    for (const r of (exp.data ?? []) as Record<string, string>[])
      rows.push({ type: "expense", label: r.memo || "Expense", sub: "Expense", amount: r.total, currency: r.currency, created_at: r.created_at });
    return rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 12);
  }

  private async rpc(fn: string, params: Record<string, unknown>) {
    const { data, error } = await this.db.rpc(fn, params);
    if (error) throw new BadRequestException(pgMessage(error));
    return data ?? [];
  }

  taxSummary(companyId: string, from?: string, to?: string) {
    return this.rpc("report_tax_summary", { p_company: companyId, p_from: from ?? null, p_to: to ?? null });
  }
  dayBook(companyId: string, from?: string, to?: string) {
    return this.rpc("report_day_book", { p_company: companyId, p_from: from ?? null, p_to: to ?? null });
  }
  salesRegister(companyId: string, from?: string, to?: string) {
    return this.rpc("report_sales_register", { p_company: companyId, p_from: from ?? null, p_to: to ?? null });
  }
  purchaseRegister(companyId: string, from?: string, to?: string) {
    return this.rpc("report_purchase_register", { p_company: companyId, p_from: from ?? null, p_to: to ?? null });
  }

  async aging(companyId: string, kind: "ar" | "ap", asOf?: string): Promise<AgingRow[]> {
    const fn = kind === "ar" ? "report_ar_aging" : "report_ap_aging";
    const { data, error } = await this.db.rpc(fn, { p_company: companyId, p_as_of: asOf ?? new Date().toISOString().slice(0, 10) });
    if (error) throw new BadRequestException(pgMessage(error));
    return (data ?? []).map((r: Record<string, unknown>) => ({
      party_id: r.party_id as string,
      party_name: r.party_name as string,
      current: String(r.current ?? 0),
      d1_30: String(r.d1_30 ?? 0),
      d31_60: String(r.d31_60 ?? 0),
      d61_90: String(r.d61_90 ?? 0),
      d90_plus: String(r.d90_plus ?? 0),
      total: String(r.total ?? 0),
    }));
  }
}

@ApiTags("reports")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("reports")
class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Get("trial-balance")
  trialBalance(@CompanyId() companyId: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.svc.trialBalance(companyId, from, to);
  }

  @Get("profit-loss")
  profitLoss(@CompanyId() companyId: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.svc.profitAndLoss(companyId, from, to);
  }

  @Get("balance-sheet")
  balanceSheet(@CompanyId() companyId: string, @Query("as_of") asOf?: string) {
    return this.svc.balanceSheet(companyId, asOf);
  }

  @Get("ar-aging")
  arAging(@CompanyId() companyId: string, @Query("as_of") asOf?: string) {
    return this.svc.aging(companyId, "ar", asOf);
  }

  @Get("ap-aging")
  apAging(@CompanyId() companyId: string, @Query("as_of") asOf?: string) {
    return this.svc.aging(companyId, "ap", asOf);
  }

  @Get("general-ledger")
  generalLedger(
    @CompanyId() companyId: string,
    @Query("account") account?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.svc.generalLedger(companyId, account, from, to);
  }

  @Get("inventory-valuation")
  inventoryValuation(@CompanyId() companyId: string) {
    return this.svc.inventoryValuation(companyId);
  }

  @Get("recent-activity")
  recentActivity(@CompanyId() companyId: string) {
    return this.svc.recentActivity(companyId);
  }

  @Get("low-stock")
  lowStock(@CompanyId() companyId: string) {
    return this.svc.lowStock(companyId);
  }

  @Get("tax-summary")
  taxSummary(@CompanyId() companyId: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.svc.taxSummary(companyId, from, to);
  }

  @Get("day-book")
  dayBook(@CompanyId() companyId: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.svc.dayBook(companyId, from, to);
  }

  @Get("sales-register")
  salesRegister(@CompanyId() companyId: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.svc.salesRegister(companyId, from, to);
  }

  @Get("purchase-register")
  purchaseRegister(@CompanyId() companyId: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.svc.purchaseRegister(companyId, from, to);
  }

  @Get("customer-statement")
  customerStatement(@CompanyId() companyId: string, @Query("party_id") partyId?: string) {
    return this.svc.statement(companyId, "customer", partyId || undefined);
  }

  @Get("supplier-statement")
  supplierStatement(@CompanyId() companyId: string, @Query("party_id") partyId?: string) {
    return this.svc.statement(companyId, "supplier", partyId || undefined);
  }
}

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, AuthGuard],
})
export class ReportsModule {}
