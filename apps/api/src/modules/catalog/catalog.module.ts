import { Module } from "@nestjs/common";
import { CatalogController } from "./catalog.controller";
import { CatalogService } from "./catalog.service";
import { AuthGuard } from "../../auth/auth.guard";

@Module({
  controllers: [CatalogController],
  providers: [CatalogService, AuthGuard],
})
export class CatalogModule {}
