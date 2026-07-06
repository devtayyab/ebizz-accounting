import { NotFoundException } from "@nestjs/common";
import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolves the organization_id that owns a company, using the request-scoped
 * (RLS-enforced) client — so this only succeeds if the caller is a member.
 * New rows must be stamped with this org id to satisfy the write policies.
 */
export async function resolveOrganizationId(
  db: SupabaseClient,
  companyId: string,
): Promise<string> {
  const { data, error } = await db
    .from("companies")
    .select("organization_id")
    .eq("id", companyId)
    .single();

  if (error || !data) {
    throw new NotFoundException(`Company ${companyId} not found or not accessible`);
  }
  return (data as { organization_id: string }).organization_id;
}

/** Translates a PostgREST error into an HTTP-friendly message. */
export function pgMessage(error: { message: string; code?: string } | null): string {
  if (!error) return "Unknown database error";
  return error.message;
}
