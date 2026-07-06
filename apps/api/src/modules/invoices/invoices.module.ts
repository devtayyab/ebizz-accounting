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
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../../auth/auth.guard";
import { CompanyId } from "../../common/company-id.decorator";
import { PaginationQueryDto } from "../../common/pagination.dto";
import { InvoicesService } from "./invoices.service";
import { CreateInvoiceDto, UpdateInvoiceDto } from "./dto";

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
