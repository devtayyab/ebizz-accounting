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
import { BillsService } from "./bills.service";
import { CreateBillDto, UpdateBillDto } from "./dto";

/** Pay a bill/deposit to a supplier through a fund (cash/logistics/bank). */
class PayFundDto {
  @ApiProperty({ description: "Fund the payment is made from" }) @IsUUID() fund_id!: string;
  @ApiPropertyOptional({ description: "Amount in the bill currency; omit for the full balance" })
  @IsOptional() @IsNumberString() amount?: string;
}

@ApiTags("bills")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("bills")
class BillsController {
  constructor(private readonly svc: BillsService) {}

  @Get()
  list(@CompanyId() companyId: string, @Query() query: PaginationQueryDto) {
    return this.svc.list(companyId, query);
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.get(id);
  }

  @Post()
  create(@Body() dto: CreateBillDto) {
    return this.svc.create(dto);
  }

  @Patch(":id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateBillDto) {
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

  @Post(":id/pay-via-fund")
  payViaFund(@Param("id", ParseUUIDPipe) id: string, @Body() dto: PayFundDto) {
    return this.svc.payViaFund(id, dto.fund_id, dto.amount);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.remove(id);
  }
}

@Module({
  controllers: [BillsController],
  providers: [BillsService, AuthGuard],
})
export class BillsModule {}
