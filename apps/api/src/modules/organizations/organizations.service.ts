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
import { BootstrapOrgDto, CreateCompanyDto } from "./dto";

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
}
