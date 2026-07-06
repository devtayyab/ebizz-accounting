import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import type { Customer, Item, Paginated, SalesInvoice } from "@ebizz/shared";
import { api } from "../lib/api";
import { useCompany } from "../state/CompanyContext";
import { InvoiceTemplate, InvoiceTemplateData, TemplateStyle } from "../components/InvoiceTemplate";

export function InvoiceView() {
  const { id } = useParams();
  const { activeCompany } = useCompany();
  const [template, setTemplate] = useState<TemplateStyle>("modern");

  const { data: invoice } = useQuery({
    queryKey: ["invoice", id], queryFn: () => api.get<SalesInvoice>(`/invoices/${id}`), enabled: !!id,
  });
  const { data: customers } = useQuery({ queryKey: ["customers", "all"], queryFn: () => api.get<Paginated<Customer>>("/customers?page=1&page_size=200") });
  const { data: items } = useQuery({ queryKey: ["items", "all"], queryFn: () => api.get<Paginated<Item>>("/items?page=1&page_size=200") });

  if (!invoice) return <p className="muted">Loading…</p>;
  const customer = customers?.data.find((c) => c.id === invoice.customer_id);
  const itemName = (itemId: string | null, fallback: string | null) =>
    items?.data.find((i) => i.id === itemId)?.name ?? fallback ?? "—";

  const data: InvoiceTemplateData = {
    company: {
      name: activeCompany?.name ?? "", legal: activeCompany?.legal_name,
      address: activeCompany?.address_line1, city: activeCompany?.city, country: activeCompany?.country,
      phone: activeCompany?.phone, email: activeCompany?.email, taxNumber: activeCompany?.tax_number, logo: activeCompany?.logo_url,
    },
    number: invoice.invoice_number,
    date: invoice.invoice_date,
    dueDate: invoice.due_date,
    billTo: { name: customer?.name ?? "—", email: customer?.email, taxNumber: customer?.tax_number, address: customer?.address_line1, city: customer?.city, country: customer?.country },
    shipTo: { name: invoice.ship_to_name, address: invoice.ship_to_address, city: invoice.ship_to_city, country: invoice.ship_to_country },
    lines: (invoice.lines ?? []).map((l) => ({
      name: itemName(l.item_id, l.description), qty: Number(l.quantity),
      price: l.unit_price, tax: l.tax_amount, amount: l.line_total,
    })),
    subtotal: invoice.subtotal, taxTotal: invoice.tax_total,
    discount: invoice.discount_total, shipping: invoice.shipping_total, total: invoice.total,
    paid: invoice.amount_paid, currency: invoice.currency, notes: invoice.notes,
    terms: invoice.terms, footer: activeCompany?.invoice_footer,
  };

  return (
    <div>
      <div className="page-head no-print">
        <Link to="/invoices"><button>← Back</button></Link>
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
        <InvoiceTemplate data={data} template={template} />
      </div>
    </div>
  );
}
