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
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../../auth/auth.guard";
import { CompanyId } from "../../common/company-id.decorator";
import { CatalogService } from "./catalog.service";
import { CreateAccountDto, CreateLocationDto, UpdateAccountDto, UpdateLocationDto } from "./dto";

@ApiTags("catalog")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get("currencies")
  currencies() {
    return this.catalog.currencies();
  }

  @Get("accounts")
  accounts(@CompanyId() companyId: string) {
    return this.catalog.accounts(companyId);
  }

  @Post("accounts")
  createAccount(@Body() dto: CreateAccountDto) {
    return this.catalog.createAccount(dto);
  }

  @Patch("accounts/:id")
  updateAccount(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateAccountDto) {
    return this.catalog.updateAccount(id, dto);
  }

  @Delete("accounts/:id")
  @HttpCode(204)
  deleteAccount(@Param("id", ParseUUIDPipe) id: string) {
    return this.catalog.deleteAccount(id);
  }

  @Get("locations")
  locations(@CompanyId() companyId: string) {
    return this.catalog.locations(companyId);
  }

  @Post("locations")
  createLocation(@Body() dto: CreateLocationDto) {
    return this.catalog.createLocation(dto);
  }

  @Patch("locations/:id")
  updateLocation(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.catalog.updateLocation(id, dto);
  }

  @Delete("locations/:id")
  @HttpCode(204)
  deleteLocation(@Param("id", ParseUUIDPipe) id: string) {
    return this.catalog.deleteLocation(id);
  }
}
