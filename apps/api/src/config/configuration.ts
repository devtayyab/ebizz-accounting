/**
 * Central typed configuration, loaded from environment variables.
 * Fails fast at boot if a required Supabase secret is missing.
 */
export interface AppConfig {
  port: number;
  globalPrefix: string;
  corsOrigin: string;
  supabase: {
    url: string;
    anonKey: string;
    serviceRoleKey: string;
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  return {
    // Cloud hosts (Render, Railway, Fly…) inject PORT; fall back to API_PORT locally.
    port: parseInt(process.env.PORT ?? process.env.API_PORT ?? "3000", 10),
    globalPrefix: process.env.API_GLOBAL_PREFIX ?? "api/v1",
    corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
    supabase: {
      url: required("SUPABASE_URL"),
      anonKey: required("SUPABASE_ANON_KEY"),
      serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    },
  };
}
