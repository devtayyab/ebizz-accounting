import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import type { Account, Customer, Paginated, Payment, Supplier } from "@ebizz/shared";
import { api } from "../lib/api";
import { useCompany } from "../state/CompanyContext";
import { VoucherTemplate, VoucherData } from "../components/VoucherTemplate";

type PaymentDetail = Payment & { allocations: { amount: string; document: string | null }[] };

export function VoucherView() {
  const { id } = useParams();
  const { activeCompany } = useCompany();

  const { data: payment } = useQuery({
    queryKey: ["payment", id], queryFn: () => api.get<PaymentDetail>(`/payments/${id}`), enabled: !!id,
  });
  const { data: customers } = useQuery({ queryKey: ["customers", "all"], queryFn: () => api.get<Paginated<Customer>>("/customers?page=1&page_size=200") });
  const { data: suppliers } = useQuery({ queryKey: ["suppliers", "all"], queryFn: () => api.get<Paginated<Supplier>>("/suppliers?page=1&page_size=200") });
  const { data: accounts } = useQuery({ queryKey: ["accounts", "all"], queryFn: () => api.get<Account[]>("/accounts") });

  if (!payment) return <p className="muted">Loading…</p>;

  const isReceipt = payment.party_type === "customer";
  const partyName = isReceipt
    ? (customers?.data.find((c) => c.id === payment.customer_id)?.name ?? "—")
    : (suppliers?.data.find((s) => s.id === payment.supplier_id)?.name ?? "—");
  const account = accounts?.find((a) => a.id === payment.deposit_account_id);
  const accountName = account ? `${account.code} — ${account.name}` : null;

  const data: VoucherData = {
    kind: isReceipt ? "receipt" : "payment",
    company: {
      name: activeCompany?.name ?? "", legal: activeCompany?.legal_name,
      address: activeCompany?.address_line1, city: activeCompany?.city, country: activeCompany?.country,
      phone: activeCompany?.phone, email: activeCompany?.email, taxNumber: activeCompany?.tax_number, logo: activeCompany?.logo_url,
    },
    voucherNo: `${isReceipt ? "RV" : "PV"}-${payment.id.slice(0, 8).toUpperCase()}`,
    date: payment.payment_date,
    partyName,
    amount: payment.amount,
    currency: payment.currency,
    method: payment.method,
    reference: payment.reference,
    accountName,
    allocations: payment.allocations ?? [],
    reversed: payment.reversed,
    footer: activeCompany?.invoice_footer,
  };

  return (
    <div>
      <div className="page-head no-print">
        <Link to="/payments"><button>← Back</button></Link>
        <button className="primary" onClick={() => window.print()}>Print / Save PDF</button>
      </div>
      <div className="card">
        <VoucherTemplate data={data} />
      </div>
    </div>
  );
}
