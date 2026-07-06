import { supabase } from "./supabase";
import { env } from "./env";

/**
 * Thin fetch wrapper for the NestJS API. Automatically attaches the current
 * Supabase access token and the active company id (read from localStorage) so
 * every request is authenticated and company-scoped.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (session?.access_token) {
    headers["Authorization"] = `Bearer ${session.access_token}`;
  }
  const companyId = localStorage.getItem("ebizz.companyId");
  if (companyId) headers["x-company-id"] = companyId;

  const res = await fetch(`${env.apiUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) return undefined as T;

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      payload?.error?.message ?? payload?.message ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, Array.isArray(message) ? message.join(", ") : message);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
