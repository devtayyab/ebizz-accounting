// Vite exposes only VITE_-prefixed vars to the browser. Fail loudly in dev if
// the Supabase config is missing so misconfiguration is obvious.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  // eslint-disable-next-line no-console
  console.error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env",
  );
}

export const env = {
  supabaseUrl: url ?? "",
  supabaseAnonKey: anonKey ?? "",
  apiUrl: (import.meta.env.VITE_API_URL as string) ?? "http://localhost:3000/api/v1",
};
