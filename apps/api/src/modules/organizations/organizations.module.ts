import { Module } from "@nestjs/common";
import { OrganizationsController } from "./organizations.controller";
import { OrganizationsService } from "./organizations.service";
import { AuthGuard } from "../../auth/auth.guard";

@Module({
  controllers: [OrganizationsController],
  providers: [OrganizationsService, AuthGuard],
})
export class OrganizationsModule {}
