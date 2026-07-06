import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Injectable,
  Module, NotFoundException, Param, ParseUUIDPipe, Post, Scope, UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsDateString, IsNumberString, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { SupabaseClient } from "@supabase/supabase-js";
import type { SalesOrder } from "@ebizz/shared";
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
  @ApiProperty() @IsNumberString() unit_price!: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() tax_rate?: string;
}
class CreateSalesOrderDto {
  @ApiProperty() @IsUUID() company_id!: string;
  @ApiProperty() @IsUUID() customer_id!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() location_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expected_date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({ example: "USD" }) @IsOptional() @IsString() currency?: string;
  @ApiPropertyOptional({ description: "1 doc currency = fx_rate base currency" }) @IsOptional() @IsNumberString() fx_rate?: string;
  @ApiProperty({ type: [OrderLineDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => OrderLineDto) lines!: OrderLineDto[];
}

@Injectable({ scope: Scope.REQUEST })
class SalesOrdersService {
  constructor(@Inject(REQUEST_SUPABASE) private readonly db: SupabaseClient) {}

  private async company(companyId: string) {
    const { data, error } = await this.db.from("companies").select("organization_id, base_currency").eq("id", companyId).maybeSingle();
    if (error || !data) throw new NotFoundException("Company not accessible");
    return data as { organization_id: string; base_currency: string };
  }

  async list(companyId: string): Promise<SalesOrder[]> {
    const { data, error } = await this.db.from("sales_orders").select("*").eq("company_id", companyId).order("order_date", { ascending: false });
    if (error) throw new BadRequestException(pgMessage(error));
    return (data ?? []) as SalesOrder[];
  }

  async get(id: string): Promise<SalesOrder> {
    const { data, error } = await this.db.from("sales_orders").select("*, lines:sales_order_lines(*)").eq("id", id).maybeSingle();
    if (error) throw new BadRequestException(pgMessage(error));
    if (!data) throw new NotFoundException("Sales order not found");
    return data as SalesOrder;
  }

  async create(dto: CreateSalesOrderDto): Promise<SalesOrder> {
    const { organization_id, base_currency } = await this.company(dto.company_id);
    const number = await nextDocNumber(this.db, "sales_orders", "order_number", dto.company_id, "SO-");
    const computed = dto.lines.map((l, i) => {
      const c = computeLine(Number(l.quantity), Number(l.unit_price), Number(l.tax_rate ?? 0));
      return {
        organization_id, line_no: i + 1, item_id: l.item_id ?? null, description: l.description ?? null,
        quantity: l.quantity, unit_price: l.unit_price, tax_rate: l.tax_rate ?? "0",
        line_subtotal: c.line_subtotal, tax_amount: c.tax_amount, line_total: c.line_total,
      };
    });
    const subtotal = sum(computed.map((c) => c.line_subtotal));
    const tax_total = sum(computed.map((c) => c.tax_amount));
    const currency = dto.currency || base_currency;
    const fx_rate = currency === base_currency ? "1" : (dto.fx_rate && Number(dto.fx_rate) > 0 ? dto.fx_rate : "1");
    const { data: order, error } = await this.db.from("sales_orders").insert({
      organization_id, company_id: dto.company_id, customer_id: dto.customer_id,
      location_id: dto.location_id ?? null, order_number: number, expected_date: dto.expected_date ?? null,
      currency, fx_rate, subtotal, tax_total, total: sum([subtotal, tax_total]), notes: dto.notes ?? null,
    }).select("id").single();
    if (error) throw new BadRequestException(pgMessage(error));
    const orderId = (order as { id: string }).id;
    const { error: le } = await this.db.from("sales_order_lines").insert(computed.map((c) => ({ ...c, order_id: orderId })));
    if (le) throw new BadRequestException(pgMessage(le));
    return this.get(orderId);
  }

  /** Create a draft sales invoice from this order's lines and link them. */
  async convert(id: string): Promise<{ invoice_id: string }> {
    const order = await this.get(id);
    if (order.status === "invoiced") throw new BadRequestException("Order already invoiced");
    const number = await nextDocNumber(this.db, "sales_invoices", "invoice_number", order.company_id, "INV-");
    const { data: inv, error } = await this.db.from("sales_invoices").insert({
      organization_id: order.organization_id, company_id: order.company_id, customer_id: order.customer_id,
      location_id: order.location_id, invoice_number: number, currency: order.currency, fx_rate: order.fx_rate,
      subtotal: order.subtotal, tax_total: order.tax_total, total: order.total,
    }).select("id").single();
    if (error) throw new BadRequestException(pgMessage(error));
    const invoiceId = (inv as { id: string }).id;
    const lines = (order.lines ?? []).map((l) => ({
      organization_id: order.organization_id, invoice_id: invoiceId, line_no: l.line_no,
      item_id: l.item_id, description: l.description, quantity: l.quantity, unit_price: l.unit_price,
      tax_rate: l.tax_rate, line_subtotal: l.line_subtotal, tax_amount: l.tax_amount, line_total: l.line_total,
    }));
    const { error: le } = await this.db.from("sales_invoice_lines").insert(lines);
    if (le) throw new BadRequestException(pgMessage(le));
    await this.db.from("sales_orders").update({ status: "invoiced", invoice_id: invoiceId }).eq("id", id);
    return { invoice_id: invoiceId };
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db.from("sales_orders").delete().eq("id", id).neq("status", "invoiced");
    if (error) throw new BadRequestException(pgMessage(error));
  }
}

@ApiTags("sales-orders")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("sales-orders")
class SalesOrdersController {
  constructor(private readonly svc: SalesOrdersService) {}
  @Get() list(@CompanyId() c: string) { return this.svc.list(c); }
  @Get(":id") get(@Param("id", ParseUUIDPipe) id: string) { return this.svc.get(id); }
  @Post() create(@Body() dto: CreateSalesOrderDto) { return this.svc.create(dto); }
  @Post(":id/convert") convert(@Param("id", ParseUUIDPipe) id: string) { return this.svc.convert(id); }
  @Delete(":id") @HttpCode(204) remove(@Param("id", ParseUUIDPipe) id: string) { return this.svc.remove(id); }
}

@Module({ controllers: [SalesOrdersController], providers: [SalesOrdersService, AuthGuard] })
export class SalesOrdersModule {}
