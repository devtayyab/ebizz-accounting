import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Scope,
} from "@nestjs/common";
import { SupabaseClient } from "@supabase/supabase-js";
import type { Customer, Paginated } from "@ebizz/shared";
import { REQUEST_SUPABASE } from "../../supabase/supabase.module";
import { PaginationQueryDto, toRange } from "../../common/pagination.dto";
import { pgMessage, resolveOrganizationId } from "../../common/company.util";
import { CreateCustomerDto, UpdateCustomerDto } from "./dto";

@Injectable({ scope: Scope.REQUEST })
export class CustomersService {
  constructor(@Inject(REQUEST_SUPABASE) private readonly db: SupabaseClient) {}

  async list(companyId: string, query: PaginationQueryDto): Promise<Paginated<Customer>> {
    const [from, to] = toRange(query.page, query.page_size);
    let q = this.db
      .from("customers")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .order("name", { ascending: true })
      .range(from, to);

    if (query.q) q = q.ilike("name", `%${query.q}%`);

    const { data, error, count } = await q;
    if (error) throw new BadRequestException(pgMessage(error));
    return {
      data: (data ?? []) as Customer[],
      page: query.page,
      page_size: query.page_size,
      total: count ?? 0,
    };
  }

  async get(id: string): Promise<Customer> {
    const { data, error } = await this.db
      .from("customers")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new BadRequestException(pgMessage(error));
    if (!data) throw new NotFoundException(`Customer ${id} not found`);
    return data as Customer;
  }

  async create(dto: CreateCustomerDto): Promise<Customer> {
    const organization_id = await resolveOrganizationId(this.db, dto.company_id);
    const { data, error } = await this.db
      .from("customers")
      .insert({ ...dto, organization_id })
      .select("*")
      .single();
    if (error) throw new BadRequestException(pgMessage(error));
    return data as Customer;
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<Customer> {
    const { company_id: _c, ...patch } = dto;
    const { data, error } = await this.db
      .from("customers")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new BadRequestException(pgMessage(error));
    if (!data) throw new NotFoundException(`Customer ${id} not found`);
    return data as Customer;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db.from("customers").delete().eq("id", id);
    if (error) throw new BadRequestException(pgMessage(error));
  }
}
