import { Global, Module, Scope } from "@nestjs/common";
import { REQUEST } from "@nestjs/core";
import type { Request } from "express";
import { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseService } from "./supabase.service";

/** Injection token for the per-request, RLS-enforced Supabase client. */
export const REQUEST_SUPABASE = "REQUEST_SUPABASE";

/**
 * Provides a request-scoped SupabaseClient bound to the caller's bearer token.
 * The AuthGuard runs first and guarantees a token is present, but we fall back
 * to the admin client's anon behaviour defensively if not.
 */
@Global()
@Module({
  providers: [
    SupabaseService,
    {
      provide: REQUEST_SUPABASE,
      scope: Scope.REQUEST,
      inject: [SupabaseService, REQUEST],
      useFactory: (supabase: SupabaseService, req: Request): SupabaseClient => {
        const header = req.headers["authorization"] ?? "";
        const token = header.startsWith("Bearer ") ? header.slice(7) : "";
        return supabase.forToken(token);
      },
    },
  ],
  exports: [SupabaseService, REQUEST_SUPABASE],
})
export class SupabaseModule {}
