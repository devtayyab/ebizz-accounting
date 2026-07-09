// Plain data shapes returned by the API and consumed by the web client.
// Money is represented as a string in JSON to avoid float rounding; the API
// stores NUMERIC(18,4) in Postgres. Parse to a decimal library on either side
// when doing arithmetic.

import type { AccountType, ItemType, JournalStatus, OrgRole } from "./enums";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface Company {
  id: string;
  organization_id: string;
  name: string;
  legal_name: string | null;
  base_currency: string; // ISO 4217, e.g. "EUR"
  country: string | null; // ISO 3166-1 alpha-2
  address_line1: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  tax_number: string | null;
  invoice_terms: string | null;
  invoice_footer: string | null;
  logo_url: string | null;
  created_at: string;
}

export interface Membership {
  id: string;
  organization_id: string;
  user_id: string;
  role: OrgRole;
  created_at: string;
}

export interface Account {
  id: string;
  organization_id: string;
  company_id: string;
  code: string;
  name: string;
  type: AccountType;
  parent_id: string | null;
  currency: string | null;
  is_active: boolean;
}

export interface Supplier {
  id: string;
  organization_id: string;
  company_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  tax_number: string | null;
  currency: string | null;
  payment_terms_days: number;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  country: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Customer {
  id: string;
  organization_id: string;
  company_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  tax_number: string | null;
  currency: string | null;
  payment_terms_days: number;
  credit_limit: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  country: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Item {
  id: string;
  organization_id: string;
  company_id: string;
  sku: string;
  name: string;
  description: string | null;
  type: ItemType;
  unit: string;
  category_id: string | null;
  purchase_price: string | null;
  sale_price: string | null;
  currency: string | null;
  track_inventory: boolean;
  reorder_point: string | null;
  income_account_id: string | null;
  expense_account_id: string | null;
  inventory_account_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface ItemSupplier {
  id: string;
  organization_id: string;
  item_id: string;
  supplier_id: string;
  supplier_sku: string | null;
  cost: string | null;
  lead_time_days: number | null;
  is_preferred: boolean;
}

export interface InventoryLevel {
  item_id: string;
  location_id: string;
  quantity_on_hand: string;
  average_cost: string;
}

export interface TaxRate {
  id: string;
  organization_id: string;
  company_id: string;
  name: string;
  rate: string; // decimal fraction, e.g. "0.15"
  is_active: boolean;
}

export type DocumentStatus = "draft" | "posted" | "void";

export interface SalesInvoiceLine {
  id?: string;
  line_no: number;
  item_id: string | null;
  description: string | null;
  line_kind?: "item" | "service";
  quantity: string;
  unit_price: string;
  tax_rate_id: string | null;
  tax_rate: string;
  line_subtotal: string;
  tax_amount: string;
  line_total: string;
  income_account_id: string | null;
}

export interface SalesInvoice {
  id: string;
  organization_id: string;
  company_id: string;
  customer_id: string;
  location_id: string | null;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  status: DocumentStatus;
  currency: string;
  fx_rate: string;
  subtotal: string;
  tax_total: string;
  discount_total: string;
  shipping_total: string;
  total: string;
  amount_paid: string;
  notes: string | null;
  terms: string | null;
  ship_to_name: string | null;
  ship_to_address: string | null;
  ship_to_city: string | null;
  ship_to_country: string | null;
  journal_entry_id: string | null;
  created_at: string;
  lines?: SalesInvoiceLine[];
}

export interface PurchaseBillLine {
  id?: string;
  line_no: number;
  item_id: string | null;
  description: string | null;
  line_kind?: "item" | "service";
  quantity: string;
  unit_cost: string;
  tax_rate_id: string | null;
  tax_rate: string;
  line_subtotal: string;
  tax_amount: string;
  line_total: string;
  expense_account_id: string | null;
}

export interface PurchaseBill {
  id: string;
  organization_id: string;
  company_id: string;
  supplier_id: string;
  location_id: string | null;
  bill_number: string;
  bill_date: string;
  due_date: string | null;
  status: DocumentStatus;
  currency: string;
  fx_rate: string;
  subtotal: string;
  tax_total: string;
  discount_total: string;
  shipping_total: string;
  total: string;
  amount_paid: string;
  notes: string | null;
  journal_entry_id: string | null;
  created_at: string;
  lines?: PurchaseBillLine[];
}

export interface Payment {
  id: string;
  organization_id: string;
  company_id: string;
  party_type: "customer" | "supplier";
  customer_id: string | null;
  supplier_id: string | null;
  payment_date: string;
  amount: string;
  currency: string;
  fx_rate: string;
  method: string | null;
  deposit_account_id: string;
  reference: string | null;
  reversed: boolean;
  journal_entry_id: string | null;
  created_at: string;
}

/** A row in the Trial Balance report. */
export interface TrialBalanceRow {
  account_id: string;
  code: string;
  name: string;
  type: AccountType;
  debit: string;
  credit: string;
}

/** A grouped line in a P&L or Balance Sheet report. */
export interface ReportLine {
  account_id: string;
  code: string;
  name: string;
  type: AccountType;
  amount: string;
}

export interface ProfitAndLoss {
  income: ReportLine[];
  expenses: ReportLine[];
  total_income: string;
  total_expenses: string;
  net_profit: string;
}

export interface BalanceSheet {
  assets: ReportLine[];
  liabilities: ReportLine[];
  equity: ReportLine[];
  total_assets: string;
  total_liabilities: string;
  total_equity: string;
  retained_earnings: string;
}

export interface AgingRow {
  party_id: string;
  party_name: string;
  current: string;
  d1_30: string;
  d31_60: string;
  d61_90: string;
  d90_plus: string;
  total: string;
}

export interface OrderLine {
  id?: string;
  line_no: number;
  item_id: string | null;
  description: string | null;
  quantity: string;
  unit_price?: string;
  unit_cost?: string;
  tax_rate: string;
  line_subtotal: string;
  tax_amount: string;
  line_total: string;
}

export interface SalesOrder {
  id: string;
  organization_id: string;
  company_id: string;
  customer_id: string;
  location_id: string | null;
  order_number: string;
  order_date: string;
  expected_date: string | null;
  status: "draft" | "open" | "invoiced" | "cancelled";
  currency: string;
  fx_rate: string;
  subtotal: string;
  tax_total: string;
  total: string;
  notes: string | null;
  invoice_id: string | null;
  lines?: OrderLine[];
}

export interface PurchaseOrder {
  id: string;
  organization_id: string;
  company_id: string;
  supplier_id: string;
  location_id: string | null;
  order_number: string;
  order_date: string;
  expected_date: string | null;
  status: "draft" | "open" | "billed" | "cancelled";
  currency: string;
  fx_rate: string;
  subtotal: string;
  tax_total: string;
  total: string;
  notes: string | null;
  bill_id: string | null;
  lines?: OrderLine[];
}

export interface CreditNote {
  id: string;
  organization_id: string;
  company_id: string;
  customer_id: string;
  invoice_id: string | null;
  note_number: string;
  note_date: string;
  status: DocumentStatus;
  restock: boolean;
  currency: string;
  fx_rate: string;
  subtotal: string;
  tax_total: string;
  total: string;
  journal_entry_id: string | null;
  lines?: OrderLine[];
}

export interface DebitNote {
  id: string;
  organization_id: string;
  company_id: string;
  supplier_id: string;
  bill_id: string | null;
  note_number: string;
  note_date: string;
  status: DocumentStatus;
  restock: boolean;
  currency: string;
  fx_rate: string;
  subtotal: string;
  tax_total: string;
  total: string;
  journal_entry_id: string | null;
  lines?: OrderLine[];
}

export interface JournalLine {
  id?: string;
  account_id: string;
  description: string | null;
  debit: string;
  credit: string;
  base_debit?: string;
  base_credit?: string;
  currency?: string;
}

export interface JournalEntry {
  id: string;
  organization_id: string;
  company_id: string;
  entry_date: string;
  memo: string | null;
  reference: string | null;
  status: JournalStatus;
  source_type: string | null;
  lines?: JournalLine[];
}

export interface GeneralLedgerRow {
  entry_date: string;
  entry_id: string;
  memo: string | null;
  source_type: string | null;
  account_id: string;
  code: string;
  name: string;
  party: string | null;
  debit: string;
  credit: string;
}

export interface InventoryValuationRow {
  item_id: string;
  sku: string;
  name: string;
  quantity: string;
  average_cost: string;
  value: string;
}

export interface LowStockRow {
  item_id: string;
  sku: string;
  name: string;
  on_hand: string;
  reorder_point: string;
}

export interface Expense {
  id: string;
  organization_id: string;
  company_id: string;
  expense_date: string;
  category_account_id: string;
  supplier_id: string | null;
  paid_account_id: string | null;
  payment_status: "paid" | "unpaid";
  amount: string;
  tax_amount: string;
  total: string;
  currency: string;
  fx_rate: string;
  reference: string | null;
  memo: string | null;
  created_at: string;
}

export interface StatementRow {
  txn_date: string;
  party_id: string;
  party_name: string;
  doc_type: string;
  reference: string | null;
  charge: string;
  credit: string;
}

export interface AppProfile {
  user_id: string;
  email: string | null;
  status: "pending" | "approved" | "rejected";
  is_admin: boolean;
  created_at: string;
  decided_at: string | null;
}

export interface Paginated<T> {
  data: T[];
  page: number;
  page_size: number;
  total: number;
}
