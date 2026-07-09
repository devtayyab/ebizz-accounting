import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Scope,
} from "@nestjs/common";
import { SupabaseClient } from "@supabase/supabase-js";
import type { Paginated, Supplier } from "@ebizz/shared";
import { REQUEST_SUPABASE } from "../../supabase/supabase.module";
import { PaginationQueryDto, toRange } from "../../common/pagination.dto";
import { pgMessage, resolveOrganizationId } from "../../common/company.util";
import { CreateSupplierDto, UpdateSupplierDto } from "./dto";

@Injectable({ scope: Scope.REQUEST })
export class SuppliersService {
  constructor(@Inject(REQUEST_SUPABASE) private readonly db: SupabaseClient) {}

  async list(companyId: string, query: PaginationQueryDto): Promise<Paginated<Supplier>> {
    const [from, to] = toRange(query.page, query.page_size);
    let q = this.db
      .from("suppliers")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("name", { ascending: true })
      .range(from, to);

    if (query.q) q = q.ilike("name", `%${query.q}%`);

    const { data, error, count } = await q;
    if (error) throw new BadRequestException(pgMessage(error));
    return {
      data: (data ?? []) as Supplier[],
      page: query.page,
      page_size: query.page_size,
      total: count ?? 0,
    };
  }

  async get(id: string): Promise<Supplier> {
    const { data, error } = await this.db
      .from("suppliers")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new BadRequestException(pgMessage(error));
    if (!data) throw new NotFoundException(`Supplier ${id} not found`);
    return data as Supplier;
  }

  async create(dto: CreateSupplierDto): Promise<Supplier> {
    const organization_id = await resolveOrganizationId(this.db, dto.company_id);
    const { data, error } = await this.db
      .from("suppliers")
      .insert({ ...dto, organization_id })
      .select("*")
      .single();
    if (error) throw new BadRequestException(pgMessage(error));
    return data as Supplier;
  }

  async update(id: string, dto: UpdateSupplierDto): Promise<Supplier> {
    // company_id / organization_id are immutable after creation
    const { company_id: _c, ...patch } = dto;
    const { data, error } = await this.db
      .from("suppliers")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new BadRequestException(pgMessage(error));
    if (!data) throw new NotFoundException(`Supplier ${id} not found`);
    return data as Supplier;
  }

  /** Soft-delete: moves the supplier to the Recycle Bin. */
  async remove(id: string): Promise<void> {
    const { error } = await this.db.rpc("soft_delete_record", { p_type: "supplier", p_id: id });
    if (error) throw new BadRequestException(pgMessage(error));
  }
}
