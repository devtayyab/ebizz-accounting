import { Module } from "@nestjs/common";
import { ItemsController } from "./items.controller";
import { ItemsService } from "./items.service";
import { AuthGuard } from "../../auth/auth.guard";

@Module({
  controllers: [ItemsController],
  providers: [ItemsService, AuthGuard],
})
export class ItemsModule {}
