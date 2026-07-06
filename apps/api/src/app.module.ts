import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { SupabaseModule } from "./supabase/supabase.module";
import { HealthController } from "./modules/health/health.controller";
import { OrganizationsModule } from "./modules/organizations/organizations.module";
import { CatalogModule } from "./modules/catalog/catalog.module";
import { SuppliersModule } from "./modules/suppliers/suppliers.module";
import { CustomersModule } from "./modules/customers/customers.module";
import { ItemsModule } from "./modules/items/items.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SupabaseModule,
    OrganizationsModule,
    CatalogModule,
    SuppliersModule,
    CustomersModule,
    ItemsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
