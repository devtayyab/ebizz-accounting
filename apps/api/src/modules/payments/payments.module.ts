import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Scope,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsDateString,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from "class-validator";
import { SupabaseClient } from "@supabase/supabase-js";
import type { Payment } from "@ebizz/shared";
import { REQUEST_SUPABASE } from "../../supabase/supabase.module";
import { AuthGuard } from "../../auth/auth.guard";
import { CompanyId } from "../../common/company-id.decorator";
import { pgMessage } from "../../common/company.util";

class AllocationDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() invoice_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() bill_id?: string;
  @ApiProperty() @IsNumberString() amount!: string;
}

class CreatePaymentDto {
  @ApiProperty() @IsUUID() company_id!: string;
  @ApiProperty({ enum: ["customer", "supplier"] })
  @IsIn(["customer", "supplier"]) party_type!: "customer" | "supplier";
  @ApiProperty({ description: "customer_id or supplier_id per party_type" })
  @IsUUID() party_id!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() payment_date?: string;
  @ApiProperty() @IsNumberString() amount!: string;
  @ApiPropertyOptional({ example: "USD" }) @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @ApiPropertyOptional({ description: "1 payment currency = fx_rate base currency" }) @IsOptional() @IsNumberString() fx_rate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() method?: string;
  @ApiProperty({ description: "Cash/Bank account to deposit to / pay from" })
  @IsUUID() deposit_account_id!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reference?: string;
  @ApiPropertyOptional({ type: [AllocationDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AllocationDto)
  allocations?: AllocationDto[];
}

@Injectable({ scope: Scope.REQUEST })
class PaymentsService {
  constructor(@Inject(REQUEST_SUPABASE) private readonly db: SupabaseClient) {}

  async list(companyId: string): Promise<Payment[]> {
    const { data, error } = await this.db
      .from("payments")
      .select("*")
      .eq("company_id", companyId)
      .order("payment_date", { ascending: false });
    if (error) throw new BadRequestException(pgMessage(error));
    return (data ?? []) as Payment[];
  }

  async create(dto: CreatePaymentDto): Promise<Payment> {
    const { data: paymentId, error } = await this.db.rpc("record_payment", {
      p_company: dto.company_id,
      p_party_type: dto.party_type,
      p_party_id: dto.party_id,
      p_date: dto.payment_date ?? new Date().toISOString().slice(0, 10),
      p_amount: Number(dto.amount),
      p_currency: dto.currency ?? "USD",
      p_method: dto.method ?? null,
      p_deposit_account: dto.deposit_account_id,
      p_reference: dto.reference ?? null,
      p_allocations: dto.allocations ?? [],
      p_fx_rate: dto.fx_rate ? Number(dto.fx_rate) : 1,
    });
    if (error) throw new BadRequestException(pgMessage(error));
    const { data, error: getErr } = await this.db
      .from("payments")
      .select("*")
      .eq("id", paymentId as string)
      .maybeSingle();
    if (getErr) throw new BadRequestException(pgMessage(getErr));
    if (!data) throw new NotFoundException("Payment not found after creation");
    return data as Payment;
  }

  async reverse(id: string) {
    const { error } = await this.db.rpc("reverse_document", { p_type: "payment", p_id: id });
    if (error) throw new BadRequestException(pgMessage(error));
    return { id, reversed: true };
  }

  async restore(id: string) {
    const { error } = await this.db.rpc("restore_document", { p_type: "payment", p_id: id });
    if (error) throw new BadRequestException(pgMessage(error));
    return { id, reversed: false };
  }

  async remove(id: string): Promise<void> {
    // Undo the payment's ledger + allocation effect (if still active), then delete it.
    const { data } = await this.db.from("payments").select("reversed").eq("id", id).maybeSingle();
    if (data && !(data as { reversed: boolean }).reversed) {
      const { error: revErr } = await this.db.rpc("reverse_document", { p_type: "payment", p_id: id });
      if (revErr) throw new BadRequestException(pgMessage(revErr));
    }
    const { error } = await this.db.from("payments").delete().eq("id", id);
    if (error) throw new BadRequestException(pgMessage(error));
  }
}

@ApiTags("payments")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("payments")
class PaymentsController {
  constructor(private readonly svc: PaymentsService) {}

  @Get()
  list(@CompanyId() companyId: string) {
    return this.svc.list(companyId);
  }

  @Post()
  create(@Body() dto: CreatePaymentDto) {
    return this.svc.create(dto);
  }

  @Post(":id/reverse")
  reverse(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.reverse(id);
  }

  @Post(":id/restore")
  restore(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.restore(id);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.remove(id);
  }
}

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, AuthGuard],
})
export class PaymentsModule {}
