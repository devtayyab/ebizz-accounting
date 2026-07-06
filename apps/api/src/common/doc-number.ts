import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Next document number as PREFIX + zero-padded (highest existing suffix + 1).
 * Using the max existing number (not COUNT) avoids collisions after deletions
 * and when converting orders — COUNT+1 reuses numbers once a row is removed.
 */
export async function nextDocNumber(
  db: SupabaseClient,
  table: string,
  column: string,
  companyId: string,
  prefix: string,
): Promise<string> {
  const { data } = await db
    .from(table)
    .select(column)
    .eq("company_id", companyId)
    .ilike(column, `${prefix}%`)
    .order(column, { ascending: false })
    .limit(1);
  const last = (data as Record<string, string>[] | null)?.[0]?.[column];
  let n = 1;
  if (last) {
    const m = String(last).match(/(\d+)\s*$/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(n).padStart(5, "0")}`;
}
