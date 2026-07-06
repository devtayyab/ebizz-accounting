import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

// Browser client: persists the session in localStorage and auto-refreshes it.
export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
