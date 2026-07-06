// Domain enumerations. These mirror the CHECK constraints / enum types defined
// in the Supabase migrations — keep the two in sync.

/** A member's role within an organization (tenant). Governs write permissions. */
export const ORG_ROLES = ["owner", "admin", "accountant", "viewer"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Top-level classification of a chart-of-accounts account (accounting equation). */
export const ACCOUNT_TYPES = [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Normal balance side of an account, derived from its type. */
export const NORMAL_BALANCE = ["debit", "credit"] as const;
export type NormalBalance = (typeof NORMAL_BALANCE)[number];

/** Lifecycle of a journal entry. Only `posted` entries affect balances. */
export const JOURNAL_STATUS = ["draft", "posted", "void"] as const;
export type JournalStatus = (typeof JOURNAL_STATUS)[number];

/** What kind of thing an item is — drives whether stock is tracked. */
export const ITEM_TYPES = ["inventory", "service", "non_inventory"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/** Reasons stock moves; each movement can post a linked journal entry. */
export const INVENTORY_MOVEMENT_TYPES = [
  "purchase",
  "sale",
  "adjustment",
  "transfer_in",
  "transfer_out",
  "opening_balance",
] as const;
export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

/** Which normal balance a given account type carries. */
export function normalBalanceFor(type: AccountType): NormalBalance {
  return type === "asset" || type === "expense" ? "debit" : "credit";
}
