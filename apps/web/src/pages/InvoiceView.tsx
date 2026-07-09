import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import type { Customer, Item, Paginated, SalesInvoice, TaxRate } from "@ebizz/shared";
import { api } from "../lib/api";
import { useCompany } from "../state/CompanyContext";
import { InvoiceTemplate, InvoiceTemplateData, TemplateLine } from "../components/InvoiceTemplate";
import { taxBreakdown } from "../lib/format";

export function InvoiceView() {
  const { id } = useParams();
  const { activeCompany } = useCompany();

  const { data: invoice } = useQuery({
    queryKey: ["invoice", id], queryFn: () => api.get<SalesInvoice>(`/invoices/${id}`), enabled: !!id,
  });
  const { data: customers } = useQuery({ queryKey: ["customers", "all"], queryFn: () => api.get<Paginated<Customer>>("/customers?page=1&page_size=200") });
  const { data: items } = useQuery({ queryKey: ["items", "all"], queryFn: () => api.get<Paginated<Item>>("/items?page=1&page_size=200") });
  const { data: taxRates } = useQuery({ queryKey: ["tax-rates"], queryFn: () => api.get<TaxRate[]>("/tax-rates") });

  if (!invoice) return <p className="muted">Loading…</p>;
  const customer = customers?.data.find((c) => c.id === invoice.customer_id);
  const itemName = (itemId: string | null, fallback: string | null) =>
    items?.data.find((i) => i.id === itemId)?.name ?? fallback ?? "—";

  const lines = invoice.lines ?? [];
  const itemRows: TemplateLine[] = lines.filter((l) => (l.line_kind ?? "item") !== "service").map((l) => ({
    name: itemName(l.item_id, l.description), description: l.description, qty: Number(l.quantity),
    price: l.unit_price, tax: l.tax_amount, amount: l.line_total,
  }));
  const serviceRows: TemplateLine[] = lines.filter((l) => l.line_kind === "service").map((l) => ({
    name: l.description || "Service", description: "", qty: Number(l.quantity),
    price: l.unit_price, tax: l.tax_amount, amount: l.line_total,
  }));

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
    items: itemRows,
    services: serviceRows,
    subtotal: invoice.subtotal,
    taxLines: taxBreakdown(
      lines.map((l) => ({ taxRate: Number(l.tax_rate), taxAmount: Number(l.tax_amount) })),
      taxRates ?? [],
    ),
    discount: invoice.discount_total, shipping: invoice.shipping_total, total: invoice.total,
    paid: invoice.amount_paid, currency: invoice.currency, notes: invoice.notes,
    terms: invoice.terms, footer: activeCompany?.invoice_footer,
  };

  return (
    <div>
      <div className="page-head no-print">
        <Link to="/invoices"><button>← Back</button></Link>
        <button className="primary" onClick={() => window.print()}>Print / Save PDF</button>
      </div>
      <div className="card">
        <InvoiceTemplate data={data} />
      </div>
    </div>
  );
}
