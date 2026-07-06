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
import { BillsService } from "./bills.service";
import { CreateBillDto, UpdateBillDto } from "./dto";

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
