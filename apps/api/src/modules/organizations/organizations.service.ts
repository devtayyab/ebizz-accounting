import {
  BadRequestException,
  Inject,
  Injectable,
  Scope,
} from "@nestjs/common";
import { SupabaseClient } from "@supabase/supabase-js";
import type { Company, Organization } from "@ebizz/shared";
import { REQUEST_SUPABASE } from "../../supabase/supabase.module";
import { pgMessage } from "../../common/company.util";
import { BootstrapOrgDto, CreateCompanyDto, UpdateCompanyDto } from "./dto";

@Injectable({ scope: Scope.REQUEST })
export class OrganizationsService {
  constructor(@Inject(REQUEST_SUPABASE) private readonly db: SupabaseClient) {}

  /** One-call tenant bootstrap via the SECURITY DEFINER RPC. */
  async bootstrap(dto: BootstrapOrgDto): Promise<{ organization_id: string; company_id: string }> {
    const { data, error } = await this.db.rpc("create_organization", {
      p_name: dto.name,
      p_slug: dto.slug,
      p_company_name: dto.company_name,
      p_base_currency: dto.base_currency ?? "USD",
    });
    if (error) throw new BadRequestException(pgMessage(error));
    return data as { organization_id: string; company_id: string };
  }

  async listOrganizations(): Promise<Organization[]> {
    const { data, error } = await this.db
      .from("organizations")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new BadRequestException(pgMessage(error));
    return (data ?? []) as Organization[];
  }

  async listCompanies(): Promise<Company[]> {
    const { data, error } = await this.db
      .from("companies")
      .select("*")
      .order("name", { ascending: true });
    if (error) throw new BadRequestException(pgMessage(error));
    return (data ?? []) as Company[];
  }

  async createCompany(dto: CreateCompanyDto): Promise<Company> {
    const { data, error } = await this.db
      .from("companies")
      .insert(dto)
      .select("*")
      .single();
    if (error) throw new BadRequestException(pgMessage(error));
    const company = data as Company;
    // give the new company its own default chart of accounts
    const { error: seedError } = await this.db.rpc("seed_default_accounts", {
      p_org: company.organization_id,
      p_company: company.id,
    });
    if (seedError) throw new BadRequestException(pgMessage(seedError));
    return company;
  }

  async updateCompany(id: string, dto: UpdateCompanyDto): Promise<Company> {
    // Changing the base (functional) currency is only safe before any ledger
    // activity — otherwise stored base amounts (computed against the old base)
    // become inconsistent. Block it once posted entries exist.
    if (dto.base_currency) {
      const { data: current } = await this.db
        .from("companies").select("base_currency").eq("id", id).maybeSingle();
      const changing = current && (current as { base_currency: string }).base_currency !== dto.base_currency;
      if (changing) {
        const { count, error: cErr } = await this.db
          .from("journal_entries")
          .select("id", { count: "exact", head: true })
          .eq("company_id", id)
          .eq("status", "posted");
        if (cErr) throw new BadRequestException(pgMessage(cErr));
        if ((count ?? 0) > 0) {
          throw new BadRequestException(
            "Base currency can't be changed once you have posted transactions — it would corrupt historical figures.",
          );
        }
      }
    }
    const { data, error } = await this.db
      .from("companies")
      .update(dto)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new BadRequestException(pgMessage(error));
    return data as Company;
  }
}
