import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Scope,
} from "@nestjs/common";
import { SupabaseClient } from "@supabase/supabase-js";
import type { Paginated, PurchaseBill } from "@ebizz/shared";
import { REQUEST_SUPABASE } from "../../supabase/supabase.module";
import { PaginationQueryDto, toRange } from "../../common/pagination.dto";
import { pgMessage } from "../../common/company.util";
import { computeLine, sum } from "../../common/money";
import { nextDocNumber } from "../../common/doc-number";
import { CreateBillDto, UpdateBillDto } from "./dto";

@Injectable({ scope: Scope.REQUEST })
export class BillsService {
  constructor(@Inject(REQUEST_SUPABASE) private readonly db: SupabaseClient) {}

  private async company(companyId: string): Promise<{ organization_id: string; base_currency: string }> {
    const { data, error } = await this.db
      .from("companies")
      .select("organization_id, base_currency")
      .eq("id", companyId)
      .maybeSingle();
    if (error || !data) throw new NotFoundException(`Company ${companyId} not accessible`);
    return data as { organization_id: string; base_currency: string };
  }

  private nextNumber(companyId: string): Promise<string> {
    return nextDocNumber(this.db, "purchase_bills", "bill_number", companyId, "BILL-");
  }

  private computeLines(lines: CreateBillDto["lines"], organization_id: string) {
    return lines.map((l, i) => {
      const c = computeLine(Number(l.quantity), Number(l.unit_cost), Number(l.tax_rate ?? 0));
      return {
        organization_id,
        line_no: i + 1,
        item_id: l.item_id ?? null,
        description: l.description ?? null,
        quantity: l.quantity,
        unit_cost: l.unit_cost,
        tax_rate_id: l.tax_rate_id ?? null,
        tax_rate: l.tax_rate ?? "0",
        line_subtotal: c.line_subtotal,
        tax_amount: c.tax_amount,
        line_total: c.line_total,
        expense_account_id: l.expense_account_id ?? null,
      };
    });
  }

  async list(companyId: string, query: PaginationQueryDto): Promise<Paginated<PurchaseBill>> {
    const [from, to] = toRange(query.page, query.page_size);
    let q = this.db
      .from("purchase_bills")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("bill_date", { ascending: false })
      .range(from, to);
    if (query.q) q = q.ilike("bill_number", `%${query.q}%`);
    const { data, error, count } = await q;
    if (error) throw new BadRequestException(pgMessage(error));
    return { data: (data ?? []) as PurchaseBill[], page: query.page, page_size: query.page_size, total: count ?? 0 };
  }

  async get(id: string): Promise<PurchaseBill> {
    const { data, error } = await this.db
      .from("purchase_bills")
      .select("*, lines:purchase_bill_lines(*)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new BadRequestException(pgMessage(error));
    if (!data) throw new NotFoundException(`Bill ${id} not found`);
    return data as PurchaseBill;
  }

  async create(dto: CreateBillDto): Promise<PurchaseBill> {
    const { organization_id, base_currency } = await this.company(dto.company_id);
    const currency = dto.currency ?? base_currency;
    const number = dto.bill_number ?? (await this.nextNumber(dto.company_id));
    const computed = this.computeLines(dto.lines, organization_id);
    const subtotal = sum(computed.map((c) => c.line_subtotal));
    const tax_total = sum(computed.map((c) => c.tax_amount));
    const discount = Number(dto.discount_total ?? 0) || 0;
    const shipping = Number(dto.shipping_total ?? 0) || 0;

    const { data: bill, error } = await this.db
      .from("purchase_bills")
      .insert({
        discount_total: discount,
        shipping_total: shipping,
        organization_id,
        company_id: dto.company_id,
        supplier_id: dto.supplier_id,
        location_id: dto.location_id ?? null,
        bill_number: number,
        bill_date: dto.bill_date ?? new Date().toISOString().slice(0, 10),
        due_date: dto.due_date ?? null,
        currency,
        fx_rate: dto.fx_rate ?? "1",
        subtotal,
        tax_total,
        total: sum([subtotal, -discount, tax_total, shipping]),
        notes: dto.notes ?? null,
      })
      .select("id")
      .single();
    if (error) throw new BadRequestException(pgMessage(error));

    const billId = (bill as { id: string }).id;
    const { error: lineErr } = await this.db
      .from("purchase_bill_lines")
      .insert(computed.map((c) => ({ ...c, bill_id: billId })));
    if (lineErr) throw new BadRequestException(pgMessage(lineErr));
    return this.get(billId);
  }

  async update(id: string, dto: UpdateBillDto): Promise<PurchaseBill> {
    const existing = await this.get(id);
    if (existing.status !== "draft") throw new BadRequestException("Only draft bills can be edited");
    await this.db.from("purchase_bill_lines").delete().eq("bill_id", id);

    const computed = this.computeLines(dto.lines, existing.organization_id).map((c) => ({
      ...c,
      bill_id: id,
    }));
    const subtotal = sum(computed.map((c) => c.line_subtotal));
    const tax_total = sum(computed.map((c) => c.tax_amount));
    const discount = Number(dto.discount_total ?? 0) || 0;
    const shipping = Number(dto.shipping_total ?? 0) || 0;

    const { error } = await this.db
      .from("purchase_bills")
      .update({
        discount_total: discount,
        shipping_total: shipping,
        supplier_id: dto.supplier_id,
        location_id: dto.location_id ?? null,
        bill_date: dto.bill_date ?? existing.bill_date,
        due_date: dto.due_date ?? null,
        currency: dto.currency ?? existing.currency,
        fx_rate: dto.fx_rate ?? existing.fx_rate,
        notes: dto.notes ?? null,
        subtotal,
        tax_total,
        total: sum([subtotal, -discount, tax_total, shipping]),
      })
      .eq("id", id);
    if (error) throw new BadRequestException(pgMessage(error));
    const { error: lineErr } = await this.db.from("purchase_bill_lines").insert(computed);
    if (lineErr) throw new BadRequestException(pgMessage(lineErr));
    return this.get(id);
  }

  async post(id: string): Promise<PurchaseBill> {
    const { error } = await this.db.rpc("post_purchase_bill", { p_bill_id: id });
    if (error) throw new BadRequestException(pgMessage(error));
    return this.get(id);
  }

  async reverse(id: string): Promise<PurchaseBill> {
    const { error } = await this.db.rpc("reverse_document", { p_type: "bill", p_id: id });
    if (error) throw new BadRequestException(pgMessage(error));
    return this.get(id);
  }

  async restore(id: string): Promise<PurchaseBill> {
    const { error } = await this.db.rpc("restore_document", { p_type: "bill", p_id: id });
    if (error) throw new BadRequestException(pgMessage(error));
    return this.get(id);
  }

  /** Un-post a posted bill back to draft so it can be edited, then re-posted. */
  async revise(id: string): Promise<PurchaseBill> {
    const { error } = await this.db.rpc("revise_document", { p_type: "bill", p_id: id });
    if (error) throw new BadRequestException(pgMessage(error));
    return this.get(id);
  }

  /** Records a supplier payment for the full outstanding balance from the default cash/bank account. */
  async markPaid(id: string): Promise<PurchaseBill> {
    const bill = await this.get(id);
    if (bill.status !== "posted") throw new BadRequestException("Only posted bills can be marked paid");
    const outstanding = Number(bill.total) - Number(bill.amount_paid);
    if (outstanding <= 0.0049) throw new BadRequestException("Bill is already fully paid");
    const { data } = await this.db
      .from("accounts").select("id, code").eq("company_id", bill.company_id).eq("type", "asset").order("code");
    const rows = (data ?? []) as { id: string; code: string }[];
    const acct = rows.find((r) => r.code === "1010") ?? rows.find((r) => r.code === "1000") ?? rows[0];
    if (!acct) throw new BadRequestException("No cash/bank account found to pay from");
    const { error } = await this.db.rpc("record_payment", {
      p_company: bill.company_id, p_party_type: "supplier", p_party_id: bill.supplier_id,
      p_date: new Date().toISOString().slice(0, 10), p_amount: outstanding, p_currency: bill.currency,
      p_method: "mark_paid", p_deposit_account: acct.id, p_reference: bill.bill_number,
      p_allocations: [{ bill_id: id, amount: String(outstanding) }],
      p_fx_rate: Number(bill.fx_rate) || 1,
    });
    if (error) throw new BadRequestException(pgMessage(error));
    return this.get(id);
  }

  /** Soft-delete: reverses the ledger effect and moves the bill to the Recycle Bin. */
  async remove(id: string): Promise<void> {
    const { error } = await this.db.rpc("soft_delete_record", { p_type: "bill", p_id: id });
    if (error) throw new BadRequestException(pgMessage(error));
    // release any purchase order that was converted into this bill
    await this.db.from("purchase_orders").update({ bill_id: null, status: "open" }).eq("bill_id", id);
  }
}
