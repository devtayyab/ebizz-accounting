import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Scope,
} from "@nestjs/common";
import { SupabaseClient } from "@supabase/supabase-js";
import type {
  InventoryLevel,
  Item,
  ItemSupplier,
  Paginated,
} from "@ebizz/shared";
import { REQUEST_SUPABASE } from "../../supabase/supabase.module";
import { PaginationQueryDto, toRange } from "../../common/pagination.dto";
import { pgMessage, resolveOrganizationId } from "../../common/company.util";
import {
  CreateItemDto,
  LinkSupplierDto,
  MovementDto,
  UpdateItemDto,
} from "./dto";

@Injectable({ scope: Scope.REQUEST })
export class ItemsService {
  constructor(@Inject(REQUEST_SUPABASE) private readonly db: SupabaseClient) {}

  async list(companyId: string, query: PaginationQueryDto): Promise<Paginated<Item>> {
    const [from, to] = toRange(query.page, query.page_size);
    let q = this.db
      .from("items")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .order("name", { ascending: true })
      .range(from, to);

    if (query.q) q = q.or(`name.ilike.%${query.q}%,sku.ilike.%${query.q}%`);

    const { data, error, count } = await q;
    if (error) throw new BadRequestException(pgMessage(error));
    return {
      data: (data ?? []) as Item[],
      page: query.page,
      page_size: query.page_size,
      total: count ?? 0,
    };
  }

  async get(id: string): Promise<Item> {
    const { data, error } = await this.db
      .from("items")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new BadRequestException(pgMessage(error));
    if (!data) throw new NotFoundException(`Item ${id} not found`);
    return data as Item;
  }

  async create(dto: CreateItemDto): Promise<Item> {
    const organization_id = await resolveOrganizationId(this.db, dto.company_id);
    const { data, error } = await this.db
      .from("items")
      .insert({ ...dto, organization_id })
      .select("*")
      .single();
    if (error) throw new BadRequestException(pgMessage(error));
    return data as Item;
  }

  async update(id: string, dto: UpdateItemDto): Promise<Item> {
    const { company_id: _c, ...patch } = dto;
    const { data, error } = await this.db
      .from("items")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new BadRequestException(pgMessage(error));
    if (!data) throw new NotFoundException(`Item ${id} not found`);
    return data as Item;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db.from("items").delete().eq("id", id);
    if (error) throw new BadRequestException(pgMessage(error));
  }

  // --- sourcing: item <-> suppliers -----------------------------------------
  async listSuppliers(itemId: string): Promise<ItemSupplier[]> {
    const { data, error } = await this.db
      .from("item_suppliers")
      .select("*")
      .eq("item_id", itemId);
    if (error) throw new BadRequestException(pgMessage(error));
    return (data ?? []) as ItemSupplier[];
  }

  async linkSupplier(itemId: string, dto: LinkSupplierDto): Promise<ItemSupplier> {
    const item = await this.get(itemId);
    // upsert so re-linking updates the sourcing terms rather than erroring
    const { data, error } = await this.db
      .from("item_suppliers")
      .upsert(
        { ...dto, item_id: itemId, organization_id: item.organization_id },
        { onConflict: "item_id,supplier_id" },
      )
      .select("*")
      .single();
    if (error) throw new BadRequestException(pgMessage(error));
    return data as ItemSupplier;
  }

  async unlinkSupplier(itemId: string, supplierId: string): Promise<void> {
    const { error } = await this.db
      .from("item_suppliers")
      .delete()
      .eq("item_id", itemId)
      .eq("supplier_id", supplierId);
    if (error) throw new BadRequestException(pgMessage(error));
  }

  // --- inventory ------------------------------------------------------------
  async levels(itemId: string): Promise<InventoryLevel[]> {
    const { data, error } = await this.db
      .from("inventory_levels")
      .select("item_id, location_id, quantity_on_hand, average_cost")
      .eq("item_id", itemId);
    if (error) throw new BadRequestException(pgMessage(error));
    return (data ?? []) as InventoryLevel[];
  }

  /** Delegates to the record_inventory_movement RPC (atomic stock + ledger). */
  async recordMovement(itemId: string, dto: MovementDto) {
    const { data, error } = await this.db.rpc("record_inventory_movement", {
      p_item_id: itemId,
      p_location_id: dto.location_id,
      p_movement_type: dto.movement_type,
      p_quantity: Number(dto.quantity),
      p_unit_cost: dto.unit_cost ? Number(dto.unit_cost) : 0,
      p_reference: dto.reference ?? null,
      p_supplier_id: dto.supplier_id ?? null,
      p_customer_id: dto.customer_id ?? null,
      p_post_to_ledger: dto.post_to_ledger ?? true,
    });
    if (error) throw new BadRequestException(pgMessage(error));
    return data;
  }
}
