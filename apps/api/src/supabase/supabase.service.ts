import { Injectable } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { loadConfig } from "../config/configuration";

/**
 * Application-wide (singleton) Supabase clients.
 *
 *  - `admin` uses the service-role key and BYPASSES Row Level Security. Use it
 *    only for trusted server operations (token verification, SECURITY DEFINER
 *    RPCs). Never derive it from user input without your own authorization check.
 *  - `forToken(jwt)` returns a client that runs every query AS THE USER, so
 *    Postgres RLS enforces tenant isolation. This is the default data path.
 */
@Injectable()
export class SupabaseService {
  private readonly config = loadConfig().supabase;

  readonly admin: SupabaseClient = createClient(
    this.config.url,
    this.config.serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  /** A short-lived client bound to a user's access token (RLS-enforced). */
  forToken(accessToken: string): SupabaseClient {
    return createClient(this.config.url, this.config.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
  }
}
