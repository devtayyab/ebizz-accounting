import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { SupabaseService } from "../supabase/supabase.service";

export interface AuthUser {
  id: string;
  email: string | null;
}

/**
 * Verifies the Supabase access token on the Authorization header and attaches
 * the resolved user to the request. Data-layer authorization (which org/company
 * the user may touch) is enforced separately by Postgres RLS.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers["authorization"] ?? "";
    if (!header.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }
    const token = header.slice(7);

    const { data, error } = await this.supabase.admin.auth.getUser(token);
    if (error || !data.user) {
      throw new UnauthorizedException("Invalid or expired token");
    }

    (req as Request & { user: AuthUser }).user = {
      id: data.user.id,
      email: data.user.email ?? null,
    };
    return true;
  }
}
