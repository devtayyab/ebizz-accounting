import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import type { Item, Paginated, PurchaseBill, Supplier } from "@ebizz/shared";
import { api } from "../lib/api";
import { useCompany } from "../state/CompanyContext";
import { InvoiceTemplate, InvoiceTemplateData, TemplateStyle } from "../components/InvoiceTemplate";

export function BillView() {
  const { id } = useParams();
  const { activeCompany } = useCompany();
  const [template, setTemplate] = useState<TemplateStyle>("modern");

  const { data: bill } = useQuery({
    queryKey: ["bill", id], queryFn: () => api.get<PurchaseBill>(`/bills/${id}`), enabled: !!id,
  });
  const { data: suppliers } = useQuery({ queryKey: ["suppliers", "all"], queryFn: () => api.get<Paginated<Supplier>>("/suppliers?page=1&page_size=200") });
  const { data: items } = useQuery({ queryKey: ["items", "all"], queryFn: () => api.get<Paginated<Item>>("/items?page=1&page_size=200") });

  if (!bill) return <p className="muted">Loading…</p>;
  const supplier = suppliers?.data.find((s) => s.id === bill.supplier_id);
  const itemName = (itemId: string | null, fallback: string | null) =>
    items?.data.find((i) => i.id === itemId)?.name ?? fallback ?? "—";

  const data: InvoiceTemplateData = {
    company: {
      name: activeCompany?.name ?? "", legal: activeCompany?.legal_name,
      address: activeCompany?.address_line1, city: activeCompany?.city, country: activeCompany?.country,
      phone: activeCompany?.phone, email: activeCompany?.email, taxNumber: activeCompany?.tax_number, logo: activeCompany?.logo_url,
    },
    number: bill.bill_number,
    date: bill.bill_date,
    dueDate: bill.due_date,
    billTo: { name: supplier?.name ?? "—", email: supplier?.email, taxNumber: supplier?.tax_number, address: supplier?.address_line1, city: supplier?.city, country: supplier?.country },
    shipTo: null,
    lines: (bill.lines ?? []).map((l) => ({
      name: itemName(l.item_id, l.description), qty: Number(l.quantity),
      price: l.unit_cost, tax: l.tax_amount, amount: l.line_total,
    })),
    subtotal: bill.subtotal, taxTotal: bill.tax_total,
    discount: bill.discount_total, shipping: bill.shipping_total, total: bill.total,
    paid: bill.amount_paid, currency: bill.currency, notes: bill.notes,
    footer: activeCompany?.invoice_footer,
  };

  return (
    <div>
      <div className="page-head no-print">
        <Link to="/bills"><button>← Back</button></Link>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ margin: 0 }}>Template</label>
          <select value={template} onChange={(e) => setTemplate(e.target.value as TemplateStyle)} style={{ width: 140 }}>
            <option value="modern">Modern</option>
            <option value="classic">Classic</option>
          </select>
          <button className="primary" onClick={() => window.print()}>Print / Save PDF</button>
        </div>
      </div>
      <div className="card">
        <InvoiceTemplate data={data} template={template} docLabel="PURCHASE BILL" partyLabel="Supplier" />
      </div>
    </div>
  );
}
