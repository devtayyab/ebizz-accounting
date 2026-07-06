import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Injectable,
  Module, NotFoundException, Param, ParseUUIDPipe, Post, Scope, UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsDateString, IsNumberString, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { SupabaseClient } from "@supabase/supabase-js";
import type { PurchaseOrder } from "@ebizz/shared";
import { REQUEST_SUPABASE } from "../../supabase/supabase.module";
import { AuthGuard } from "../../auth/auth.guard";
import { CompanyId } from "../../common/company-id.decorator";
import { pgMessage } from "../../common/company.util";
import { computeLine, sum } from "../../common/money";
import { nextDocNumber } from "../../common/doc-number";

class OrderLineDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() item_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty() @IsNumberString() quantity!: string;
  @ApiProperty() @IsNumberString() unit_cost!: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() tax_rate?: string;
}
class CreatePurchaseOrderDto {
  @ApiProperty() @IsUUID() company_id!: string;
  @ApiProperty() @IsUUID() supplier_id!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() location_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expected_date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({ example: "USD" }) @IsOptional() @IsString() currency?: string;
  @ApiPropertyOptional({ description: "1 doc currency = fx_rate base currency" }) @IsOptional() @IsNumberString() fx_rate?: string;
  @ApiProperty({ type: [OrderLineDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => OrderLineDto) lines!: OrderLineDto[];
}

@Injectable({ scope: Scope.REQUEST })
class PurchaseOrdersService {
  constructor(@Inject(REQUEST_SUPABASE) private readonly db: SupabaseClient) {}

  private async company(companyId: string) {
    const { data, error } = await this.db.from("companies").select("organization_id, base_currency").eq("id", companyId).maybeSingle();
    if (error || !data) throw new NotFoundException("Company not accessible");
    return data as { organization_id: string; base_currency: string };
  }

  async list(companyId: string): Promise<PurchaseOrder[]> {
    const { data, error } = await this.db.from("purchase_orders").select("*").eq("company_id", companyId).order("order_date", { ascending: false });
    if (error) throw new BadRequestException(pgMessage(error));
    return (data ?? []) as PurchaseOrder[];
  }

  async get(id: string): Promise<PurchaseOrder> {
    const { data, error } = await this.db.from("purchase_orders").select("*, lines:purchase_order_lines(*)").eq("id", id).maybeSingle();
    if (error) throw new BadRequestException(pgMessage(error));
    if (!data) throw new NotFoundException("Purchase order not found");
    return data as PurchaseOrder;
  }

  async create(dto: CreatePurchaseOrderDto): Promise<PurchaseOrder> {
    const { organization_id, base_currency } = await this.company(dto.company_id);
    const number = await nextDocNumber(this.db, "purchase_orders", "order_number", dto.company_id, "PO-");
    const computed = dto.lines.map((l, i) => {
      const c = computeLine(Number(l.quantity), Number(l.unit_cost), Number(l.tax_rate ?? 0));
      return {
        organization_id, line_no: i + 1, item_id: l.item_id ?? null, description: l.description ?? null,
        quantity: l.quantity, unit_cost: l.unit_cost, tax_rate: l.tax_rate ?? "0",
        line_subtotal: c.line_subtotal, tax_amount: c.tax_amount, line_total: c.line_total,
      };
    });
    const subtotal = sum(computed.map((c) => c.line_subtotal));
    const tax_total = sum(computed.map((c) => c.tax_amount));
    const currency = dto.currency || base_currency;
    const fx_rate = currency === base_currency ? "1" : (dto.fx_rate && Number(dto.fx_rate) > 0 ? dto.fx_rate : "1");
    const { data: order, error } = await this.db.from("purchase_orders").insert({
      organization_id, company_id: dto.company_id, supplier_id: dto.supplier_id,
      location_id: dto.location_id ?? null, order_number: number, expected_date: dto.expected_date ?? null,
      currency, fx_rate, subtotal, tax_total, total: sum([subtotal, tax_total]), notes: dto.notes ?? null,
    }).select("id").single();
    if (error) throw new BadRequestException(pgMessage(error));
    const orderId = (order as { id: string }).id;
    const { error: le } = await this.db.from("purchase_order_lines").insert(computed.map((c) => ({ ...c, order_id: orderId })));
    if (le) throw new BadRequestException(pgMessage(le));
    return this.get(orderId);
  }

  /** Create a draft purchase bill from this order's lines and link them. */
  async convert(id: string): Promise<{ bill_id: string }> {
    const order = await this.get(id);
    if (order.status === "billed") throw new BadRequestException("Order already billed");
    const number = await nextDocNumber(this.db, "purchase_bills", "bill_number", order.company_id, "BILL-");
    const { data: bill, error } = await this.db.from("purchase_bills").insert({
      organization_id: order.organization_id, company_id: order.company_id, supplier_id: order.supplier_id,
      location_id: order.location_id, bill_number: number, currency: order.currency, fx_rate: order.fx_rate,
      subtotal: order.subtotal, tax_total: order.tax_total, total: order.total,
    }).select("id").single();
    if (error) throw new BadRequestException(pgMessage(error));
    const billId = (bill as { id: string }).id;
    const lines = (order.lines ?? []).map((l) => ({
      organization_id: order.organization_id, bill_id: billId, line_no: l.line_no,
      item_id: l.item_id, description: l.description, quantity: l.quantity, unit_cost: l.unit_cost,
      tax_rate: l.tax_rate, line_subtotal: l.line_subtotal, tax_amount: l.tax_amount, line_total: l.line_total,
    }));
    const { error: le } = await this.db.from("purchase_bill_lines").insert(lines);
    if (le) throw new BadRequestException(pgMessage(le));
    await this.db.from("purchase_orders").update({ status: "billed", bill_id: billId }).eq("id", id);
    return { bill_id: billId };
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db.from("purchase_orders").delete().eq("id", id).neq("status", "billed");
    if (error) throw new BadRequestException(pgMessage(error));
  }
}

@ApiTags("purchase-orders")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("purchase-orders")
class PurchaseOrdersController {
  constructor(private readonly svc: PurchaseOrdersService) {}
  @Get() list(@CompanyId() c: string) { return this.svc.list(c); }
  @Get(":id") get(@Param("id", ParseUUIDPipe) id: string) { return this.svc.get(id); }
  @Post() create(@Body() dto: CreatePurchaseOrderDto) { return this.svc.create(dto); }
  @Post(":id/convert") convert(@Param("id", ParseUUIDPipe) id: string) { return this.svc.convert(id); }
  @Delete(":id") @HttpCode(204) remove(@Param("id", ParseUUIDPipe) id: string) { return this.svc.remove(id); }
}

@Module({ controllers: [PurchaseOrdersController], providers: [PurchaseOrdersService, AuthGuard] })
export class PurchaseOrdersModule {}
