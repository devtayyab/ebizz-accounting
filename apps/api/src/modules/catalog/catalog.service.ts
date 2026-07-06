import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Scope,
} from "@nestjs/common";
import { SupabaseClient } from "@supabase/supabase-js";
import type { Account } from "@ebizz/shared";
import { REQUEST_SUPABASE } from "../../supabase/supabase.module";
import { pgMessage, resolveOrganizationId } from "../../common/company.util";
import { CreateLocationDto, UpdateLocationDto } from "./dto";

@Injectable({ scope: Scope.REQUEST })
export class CatalogService {
  constructor(@Inject(REQUEST_SUPABASE) private readonly db: SupabaseClient) {}

  async currencies() {
    const { data, error } = await this.db
      .from("currencies")
      .select("*")
      .order("code");
    if (error) throw new BadRequestException(pgMessage(error));
    return data ?? [];
  }

  async accounts(companyId: string): Promise<Account[]> {
    const { data, error } = await this.db
      .from("accounts")
      .select("*")
      .eq("company_id", companyId)
      .order("code");
    if (error) throw new BadRequestException(pgMessage(error));
    return (data ?? []) as Account[];
  }

  async createAccount(dto: {
    company_id: string;
    code: string;
    name: string;
    type: string;
    parent_id?: string;
    currency?: string;
  }): Promise<Account> {
    const organization_id = await resolveOrganizationId(this.db, dto.company_id);
    const { data, error } = await this.db
      .from("accounts")
      .insert({ ...dto, organization_id })
      .select("*")
      .single();
    if (error) throw new BadRequestException(pgMessage(error));
    return data as Account;
  }

  async updateAccount(id: string, dto: { code?: string; name?: string; type?: string; is_active?: boolean }): Promise<Account> {
    const { data, error } = await this.db
      .from("accounts")
      .update(dto)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new BadRequestException(pgMessage(error));
    if (!data) throw new NotFoundException(`Account ${id} not found`);
    return data as Account;
  }

  async deleteAccount(id: string): Promise<void> {
    const { error } = await this.db.from("accounts").delete().eq("id", id);
    if (error) {
      throw new BadRequestException(
        "This account can't be deleted because it's used by transactions or items. Deactivate it instead.",
      );
    }
  }

  async locations(companyId: string) {
    const { data, error } = await this.db
      .from("locations")
      .select("*")
      .eq("company_id", companyId)
      .order("name");
    if (error) throw new BadRequestException(pgMessage(error));
    return data ?? [];
  }

  async createLocation(dto: CreateLocationDto) {
    const organization_id = await resolveOrganizationId(this.db, dto.company_id);
    const { data, error } = await this.db
      .from("locations")
      .insert({ ...dto, organization_id })
      .select("*")
      .single();
    if (error) throw new BadRequestException(pgMessage(error));
    return data;
  }

  async updateLocation(id: string, dto: UpdateLocationDto) {
    const { company_id: _c, ...patch } = dto;
    const { data, error } = await this.db
      .from("locations")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new BadRequestException(pgMessage(error));
    if (!data) throw new NotFoundException(`Location ${id} not found`);
    return data;
  }

  async deleteLocation(id: string): Promise<void> {
    const { error } = await this.db.from("locations").delete().eq("id", id);
    if (error) {
      // FK violation → the warehouse still has stock or movements
      throw new BadRequestException(
        "This warehouse can't be deleted because it has stock or transactions. Deactivate it instead.",
      );
    }
  }
}
