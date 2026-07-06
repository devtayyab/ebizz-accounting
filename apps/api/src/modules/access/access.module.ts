import {
  BadRequestException, Controller, ForbiddenException, Get, Inject, Injectable,
  Module, Param, ParseUUIDPipe, Post, Scope, UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SupabaseClient } from "@supabase/supabase-js";
import type { AppProfile } from "@ebizz/shared";
import { REQUEST_SUPABASE } from "../../supabase/supabase.module";
import { AuthGuard } from "../../auth/auth.guard";
import { CurrentUser } from "../../common/current-user.decorator";
import type { AuthUser } from "../../auth/auth.guard";
import { pgMessage } from "../../common/company.util";

@Injectable({ scope: Scope.REQUEST })
class AccessService {
  constructor(@Inject(REQUEST_SUPABASE) private readonly db: SupabaseClient) {}

  /** The caller's own access profile (works even while pending). */
  async me(userId: string): Promise<AppProfile> {
    const { data, error } = await this.db
      .from("app_profiles").select("*").eq("user_id", userId).maybeSingle();
    if (error) throw new BadRequestException(pgMessage(error));
    // A brand-new row is created by the DB trigger; if the read races it, treat as pending.
    if (!data) {
      return { user_id: userId, email: null, status: "pending", is_admin: false, created_at: "", decided_at: null };
    }
    return data as AppProfile;
  }

  /** All profiles — RLS returns everyone only for an admin. */
  async list(): Promise<AppProfile[]> {
    const { data, error } = await this.db
      .from("app_profiles").select("*").order("created_at", { ascending: true });
    if (error) throw new BadRequestException(pgMessage(error));
    return (data ?? []) as AppProfile[];
  }

  async setStatus(userId: string, status: "approved" | "rejected" | "pending"): Promise<void> {
    const { error } = await this.db.rpc("set_user_access", { p_user: userId, p_status: status });
    if (error) throw new ForbiddenException(pgMessage(error));
  }
}

@ApiTags("access")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("access")
class AccessController {
  constructor(private readonly svc: AccessService) {}
  @Get("me") me(@CurrentUser() user: AuthUser) { return this.svc.me(user.id); }
  @Get() list() { return this.svc.list(); }
  @Post(":userId/approve") approve(@Param("userId", ParseUUIDPipe) id: string) { return this.svc.setStatus(id, "approved"); }
  @Post(":userId/reject") reject(@Param("userId", ParseUUIDPipe) id: string) { return this.svc.setStatus(id, "rejected"); }
}

@Module({ controllers: [AccessController], providers: [AccessService, AuthGuard] })
export class AccessModule {}
