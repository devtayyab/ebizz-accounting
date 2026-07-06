import { Module } from "@nestjs/common";
import { CustomersController } from "./customers.controller";
import { CustomersService } from "./customers.service";
import { AuthGuard } from "../../auth/auth.guard";

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, AuthGuard],
})
export class CustomersModule {}
