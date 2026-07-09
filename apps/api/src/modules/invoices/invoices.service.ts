import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Scope,
} from "@nestjs/common";
import { SupabaseClient } from "@supabase/supabase-js";
import type { Paginated, SalesInvoice } from "@ebizz/shared";
import { REQUEST_SUPABASE } from "../../supabase/supabase.module";
import { PaginationQueryDto, toRange } from "../../common/pagination.dto";
import { pgMessage } from "../../common/company.util";
import { computeLine, sum } from "../../common/money";
import { nextDocNumber } from "../../common/doc-number";
import { CreateInvoiceDto, UpdateInvoiceDto } from "./dto";

@Injectable({ scope: Scope.REQUEST })
export class InvoicesService {
  constructor(@Inject(REQUEST_SUPABASE) private readonly db: SupabaseClient) {}

  private async company(companyId: string): Promise<{ organization_id: string; base_currency: string; invoice_terms: string | null }> {
    const { data, error } = await this.db
      .from("companies")
      .select("organization_id, base_currency, invoice_terms")
      .eq("id", companyId)
      .maybeSingle();
    if (error || !data) throw new NotFoundException(`Company ${companyId} not accessible`);
    return data as { organization_id: string; base_currency: string; invoice_terms: string | null };
  }

  private nextNumber(companyId: string): Promise<string> {
    return nextDocNumber(this.db, "sales_invoices", "invoice_number", companyId, "INV-");
  }

  async list(companyId: string, query: PaginationQueryDto): Promise<Paginated<SalesInvoice>> {
    const [from, to] = toRange(query.page, query.page_size);
    let q = this.db
      .from("sales_invoices")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .order("invoice_date", { ascending: false })
      .range(from, to);
    if (query.q) q = q.ilike("invoice_number", `%${query.q}%`);
    const { data, error, count } = await q;
    if (error) throw new BadRequestException(pgMessage(error));
    return { data: (data ?? []) as SalesInvoice[], page: query.page, page_size: query.page_size, total: count ?? 0 };
  }

  async get(id: string): Promise<SalesInvoice> {
    const { data, error } = await this.db
      .from("sales_invoices")
      .select("*, lines:sales_invoice_lines(*)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new BadRequestException(pgMessage(error));
    if (!data) throw new NotFoundException(`Invoice ${id} not found`);
    return data as SalesInvoice;
  }

  async create(dto: CreateInvoiceDto): Promise<SalesInvoice> {
    const { organization_id, base_currency, invoice_terms } = await this.company(dto.company_id);
    const currency = dto.currency ?? base_currency;
    const number = dto.invoice_number ?? (await this.nextNumber(dto.company_id));

    const computed = dto.lines.map((l, i) => {
      const c = computeLine(Number(l.quantity), Number(l.unit_price), Number(l.tax_rate ?? 0));
      return {
        organization_id,
        line_no: i + 1,
        item_id: l.item_id ?? null,
        description: l.description ?? null,
        quantity: l.quantity,
        unit_price: l.unit_price,
        tax_rate_id: l.tax_rate_id ?? null,
        tax_rate: l.tax_rate ?? "0",
        line_subtotal: c.line_subtotal,
        tax_amount: c.tax_amount,
        line_total: c.line_total,
        income_account_id: l.income_account_id ?? null,
      };
    });
    const subtotal = sum(computed.map((c) => c.line_subtotal));
    const tax_total = sum(computed.map((c) => c.tax_amount));
    const discount = Number(dto.discount_total ?? 0) || 0;
    const shipping = Number(dto.shipping_total ?? 0) || 0;
    const total = sum([subtotal, -discount, tax_total, shipping]);

    const { data: invoice, error } = await this.db
      .from("sales_invoices")
      .insert({
        discount_total: discount,
        shipping_total: shipping,
        organization_id,
        company_id: dto.company_id,
        customer_id: dto.customer_id,
        location_id: dto.location_id ?? null,
        invoice_number: number,
        invoice_date: dto.invoice_date ?? new Date().toISOString().slice(0, 10),
        due_date: dto.due_date ?? null,
        currency,
        fx_rate: dto.fx_rate ?? "1",
        subtotal,
        tax_total,
        total,
        notes: dto.notes ?? null,
        terms: dto.terms ?? invoice_terms ?? null,
        ship_to_name: dto.ship_to_name ?? null,
        ship_to_address: dto.ship_to_address ?? null,
        ship_to_city: dto.ship_to_city ?? null,
        ship_to_country: dto.ship_to_country ?? null,
      })
      .select("id")
      .single();
    if (error) throw new BadRequestException(pgMessage(error));

    const invoiceId = (invoice as { id: string }).id;
    const { error: lineErr } = await this.db
      .from("sales_invoice_lines")
      .insert(computed.map((c) => ({ ...c, invoice_id: invoiceId })));
    if (lineErr) throw new BadRequestException(pgMessage(lineErr));

    return this.get(invoiceId);
  }

  async update(id: string, dto: UpdateInvoiceDto): Promise<SalesInvoice> {
    const existing = await this.get(id);
    if (existing.status !== "draft") {
      throw new BadRequestException("Only draft invoices can be edited");
    }
    await this.db.from("sales_invoice_lines").delete().eq("invoice_id", id);

    const computed = dto.lines.map((l, i) => {
      const c = computeLine(Number(l.quantity), Number(l.unit_price), Number(l.tax_rate ?? 0));
      return {
        organization_id: existing.organization_id,
        invoice_id: id,
        line_no: i + 1,
        item_id: l.item_id ?? null,
        description: l.description ?? null,
        quantity: l.quantity,
        unit_price: l.unit_price,
        tax_rate_id: l.tax_rate_id ?? null,
        tax_rate: l.tax_rate ?? "0",
        line_subtotal: c.line_subtotal,
        tax_amount: c.tax_amount,
        line_total: c.line_total,
        income_account_id: l.income_account_id ?? null,
      };
    });
    const subtotal = sum(computed.map((c) => c.line_subtotal));
    const tax_total = sum(computed.map((c) => c.tax_amount));
    const discount = Number(dto.discount_total ?? 0) || 0;
    const shipping = Number(dto.shipping_total ?? 0) || 0;

    const { error } = await this.db
      .from("sales_invoices")
      .update({
        discount_total: discount,
        shipping_total: shipping,
        customer_id: dto.customer_id,
        location_id: dto.location_id ?? null,
        invoice_date: dto.invoice_date ?? existing.invoice_date,
        due_date: dto.due_date ?? null,
        currency: dto.currency ?? existing.currency,
        fx_rate: dto.fx_rate ?? existing.fx_rate,
        notes: dto.notes ?? null,
        terms: dto.terms ?? null,
        ship_to_name: dto.ship_to_name ?? null,
        ship_to_address: dto.ship_to_address ?? null,
        ship_to_city: dto.ship_to_city ?? null,
        ship_to_country: dto.ship_to_country ?? null,
        subtotal,
        tax_total,
        total: sum([subtotal, -discount, tax_total, shipping]),
      })
      .eq("id", id);
    if (error) throw new BadRequestException(pgMessage(error));

    const { error: lineErr } = await this.db.from("sales_invoice_lines").insert(computed);
    if (lineErr) throw new BadRequestException(pgMessage(lineErr));
    return this.get(id);
  }

  async post(id: string): Promise<SalesInvoice> {
    const { error } = await this.db.rpc("post_sales_invoice", { p_invoice_id: id });
    if (error) throw new BadRequestException(pgMessage(error));
    return this.get(id);
  }

  async reverse(id: string): Promise<SalesInvoice> {
    const { error } = await this.db.rpc("reverse_document", { p_type: "invoice", p_id: id });
    if (error) throw new BadRequestException(pgMessage(error));
    return this.get(id);
  }

  async restore(id: string): Promise<SalesInvoice> {
    const { error } = await this.db.rpc("restore_document", { p_type: "invoice", p_id: id });
    if (error) throw new BadRequestException(pgMessage(error));
    return this.get(id);
  }

  /** Un-post a posted invoice back to draft so it can be edited, then re-posted. */
  async revise(id: string): Promise<SalesInvoice> {
    const { error } = await this.db.rpc("revise_document", { p_type: "invoice", p_id: id });
    if (error) throw new BadRequestException(pgMessage(error));
    return this.get(id);
  }

  /** Records a payment for the full outstanding balance into the default cash/bank account. */
  async markPaid(id: string, depositAccountId?: string): Promise<SalesInvoice> {
    const inv = await this.get(id);
    if (inv.status !== "posted") throw new BadRequestException("Only posted invoices can be marked paid");
    const outstanding = Number(inv.total) - Number(inv.amount_paid);
    if (outstanding <= 0.0049) throw new BadRequestException("Invoice is already fully paid");
    const deposit = depositAccountId ?? (await this.defaultCashAccount(inv.company_id));
    const { error } = await this.db.rpc("record_payment", {
      p_company: inv.company_id, p_party_type: "customer", p_party_id: inv.customer_id,
      p_date: new Date().toISOString().slice(0, 10), p_amount: outstanding, p_currency: inv.currency,
      p_method: "mark_paid", p_deposit_account: deposit, p_reference: inv.invoice_number,
      p_allocations: [{ invoice_id: id, amount: String(outstanding) }],
      p_fx_rate: Number(inv.fx_rate) || 1,
    });
    if (error) throw new BadRequestException(pgMessage(error));
    return this.get(id);
  }

  /**
   * Receive a payment/deposit for an invoice through a Fund. Posts a real GL
   * payment (settles A/R against the fund's linked cash/bank account) AND
   * records a fund receipt. Amount omitted → full outstanding balance.
   */
  async receivePayment(id: string, fundId: string, amount?: string): Promise<SalesInvoice> {
    const { error } = await this.db.rpc("receive_invoice_payment", {
      p_invoice: id,
      p_fund: fundId,
      p_amount: amount != null && amount !== "" ? Number(amount) : null,
      p_date: new Date().toISOString().slice(0, 10),
    });
    if (error) throw new BadRequestException(pgMessage(error));
    return this.get(id);
  }

  private async defaultCashAccount(companyId: string): Promise<string> {
    const { data } = await this.db
      .from("accounts").select("id, code").eq("company_id", companyId).eq("type", "asset").order("code");
    const rows = (data ?? []) as { id: string; code: string }[];
    const acct = rows.find((r) => r.code === "1010") ?? rows.find((r) => r.code === "1000") ?? rows[0];
    if (!acct) throw new BadRequestException("No cash/bank account found to receive payment");
    return acct.id;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.get(id);
    if (existing.status === "posted") {
      if (Number(existing.amount_paid) > 0) {
        throw new BadRequestException("Reverse the payments before deleting this invoice");
      }
      // void the ledger effect first, then remove the document
      const { error: revErr } = await this.db.rpc("reverse_document", { p_type: "invoice", p_id: id });
      if (revErr) throw new BadRequestException(pgMessage(revErr));
    }
    // release any sales order that was converted into this invoice
    await this.db.from("sales_orders").update({ invoice_id: null, status: "open" }).eq("invoice_id", id);
    const { error } = await this.db.from("sales_invoices").delete().eq("id", id);
    if (error) throw new BadRequestException(pgMessage(error));
  }
}
