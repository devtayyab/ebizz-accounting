import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { SupabaseModule } from "./supabase/supabase.module";
import { HealthController } from "./modules/health/health.controller";
import { OrganizationsModule } from "./modules/organizations/organizations.module";
import { CatalogModule } from "./modules/catalog/catalog.module";
import { SuppliersModule } from "./modules/suppliers/suppliers.module";
import { CustomersModule } from "./modules/customers/customers.module";
import { ItemsModule } from "./modules/items/items.module";
import { TaxRatesModule } from "./modules/tax-rates/tax-rates.module";
import { InvoicesModule } from "./modules/invoices/invoices.module";
import { BillsModule } from "./modules/bills/bills.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { SalesOrdersModule } from "./modules/sales-orders/sales-orders.module";
import { PurchaseOrdersModule } from "./modules/purchase-orders/purchase-orders.module";
import { CreditNotesModule } from "./modules/credit-notes/credit-notes.module";
import { DebitNotesModule } from "./modules/debit-notes/debit-notes.module";
import { JournalEntriesModule } from "./modules/journal-entries/journal-entries.module";
import { ExpensesModule } from "./modules/expenses/expenses.module";
import { FundsModule } from "./modules/funds/funds.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { AccessModule } from "./modules/access/access.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SupabaseModule,
    OrganizationsModule,
    CatalogModule,
    SuppliersModule,
    CustomersModule,
    ItemsModule,
    TaxRatesModule,
    InvoicesModule,
    BillsModule,
    PaymentsModule,
    ReportsModule,
    SalesOrdersModule,
    PurchaseOrdersModule,
    CreditNotesModule,
    DebitNotesModule,
    JournalEntriesModule,
    ExpensesModule,
    FundsModule,
    DocumentsModule,
    AccessModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
