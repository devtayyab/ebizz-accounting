import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { ItemsService } from "./items.service";
import {
  CreateItemDto,
  LinkSupplierDto,
  MovementDto,
  UpdateItemDto,
} from "./dto";

@ApiTags("items")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("items")
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  list(@CompanyId() companyId: string, @Query() query: PaginationQueryDto) {
    return this.items.list(companyId, query);
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.items.get(id);
  }

  @Post()
  create(@Body() dto: CreateItemDto) {
    return this.items.create(dto);
  }

  @Patch(":id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateItemDto) {
    return this.items.update(id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.items.remove(id);
  }

  // --- sourcing -------------------------------------------------------------
  @Get(":id/suppliers")
  listSuppliers(@Param("id", ParseUUIDPipe) id: string) {
    return this.items.listSuppliers(id);
  }

  @Post(":id/suppliers")
  linkSupplier(@Param("id", ParseUUIDPipe) id: string, @Body() dto: LinkSupplierDto) {
    return this.items.linkSupplier(id, dto);
  }

  @Delete(":id/suppliers/:supplierId")
  @HttpCode(204)
  unlinkSupplier(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("supplierId", ParseUUIDPipe) supplierId: string,
  ) {
    return this.items.unlinkSupplier(id, supplierId);
  }

  // --- inventory ------------------------------------------------------------
  @Get(":id/levels")
  levels(@Param("id", ParseUUIDPipe) id: string) {
    return this.items.levels(id);
  }

  @Post(":id/movements")
  recordMovement(@Param("id", ParseUUIDPipe) id: string, @Body() dto: MovementDto) {
    return this.items.recordMovement(id, dto);
  }
}
