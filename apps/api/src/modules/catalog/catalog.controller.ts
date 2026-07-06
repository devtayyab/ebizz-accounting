import {
  Body,
  Controller,
  Get,
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
import { CreateLocationDto, UpdateLocationDto } from "./dto";

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
}
