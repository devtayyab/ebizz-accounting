import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../../auth/auth.guard";
import { OrganizationsService } from "./organizations.service";
import { BootstrapOrgDto, CreateCompanyDto, UpdateCompanyDto } from "./dto";

@ApiTags("organizations")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller()
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Post("organizations")
  bootstrap(@Body() dto: BootstrapOrgDto) {
    return this.orgs.bootstrap(dto);
  }

  @Get("organizations")
  listOrganizations() {
    return this.orgs.listOrganizations();
  }

  @Get("companies")
  listCompanies() {
    return this.orgs.listCompanies();
  }

  @Post("companies")
  createCompany(@Body() dto: CreateCompanyDto) {
    return this.orgs.createCompany(dto);
  }

  @Patch("companies/:id")
  updateCompany(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateCompanyDto) {
    return this.orgs.updateCompany(id, dto);
  }
}
