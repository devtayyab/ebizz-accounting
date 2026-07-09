import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { IsNumberString, IsOptional, IsUUID } from "class-validator";
import { AuthGuard } from "../../auth/auth.guard";
import { CompanyId } from "../../common/company-id.decorator";
import { PaginationQueryDto } from "../../common/pagination.dto";
import { InvoicesService } from "./invoices.service";
import { CreateInvoiceDto, UpdateInvoiceDto } from "./dto";

/** Receive a payment/deposit for an invoice through a fund (cash/logistics/bank). */
class ReceivePaymentDto {
  @ApiProperty({ description: "Fund the payment is received into" }) @IsUUID() fund_id!: string;
  @ApiPropertyOptional({ description: "Amount in the invoice currency; omit for the full balance" })
  @IsOptional() @IsNumberString() amount?: string;
}

@ApiTags("invoices")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("invoices")
class InvoicesController {
  constructor(private readonly svc: InvoicesService) {}

  @Get()
  list(@CompanyId() companyId: string, @Query() query: PaginationQueryDto) {
    return this.svc.list(companyId, query);
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.get(id);
  }

  @Post()
  create(@Body() dto: CreateInvoiceDto) {
    return this.svc.create(dto);
  }

  @Patch(":id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateInvoiceDto) {
    return this.svc.update(id, dto);
  }

  @Post(":id/post")
  post(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.post(id);
  }

  @Post(":id/reverse")
  reverse(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.reverse(id);
  }

  @Post(":id/restore")
  restore(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.restore(id);
  }

  @Post(":id/revise")
  revise(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.revise(id);
  }

  @Post(":id/mark-paid")
  markPaid(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.markPaid(id);
  }

  @Post(":id/receive-payment")
  receivePayment(@Param("id", ParseUUIDPipe) id: string, @Body() dto: ReceivePaymentDto) {
    return this.svc.receivePayment(id, dto.fund_id, dto.amount);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.remove(id);
  }
}

@Module({
  controllers: [InvoicesController],
  providers: [InvoicesService, AuthGuard],
})
export class InvoicesModule {}
