import { Module } from "@nestjs/common";
import { SuppliersController } from "./suppliers.controller";
import { SuppliersService } from "./suppliers.service";
import { AuthGuard } from "../../auth/auth.guard";

@Module({
  controllers: [SuppliersController],
  providers: [SuppliersService, AuthGuard],
})
export class SuppliersModule {}
