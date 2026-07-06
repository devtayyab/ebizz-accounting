// Plain data shapes returned by the API and consumed by the web client.
// Money is represented as a string in JSON to avoid float rounding; the API
// stores NUMERIC(18,4) in Postgres. Parse to a decimal library on either side
// when doing arithmetic.

import type { AccountType, ItemType, OrgRole } from "./enums";

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

export interface Paginated<T> {
  data: T[];
  page: number;
  page_size: number;
  total: number;
}
