import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Module,
  Param, Post, Scope, UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiProperty, ApiTags } from "@nestjs/swagger";
import { IsIn, IsUUID } from "class-validator";
import { SupabaseClient } from "@supabase/supabase-js";
import { REQUEST_SUPABASE } from "../../supabase/supabase.module";
import { AuthGuard } from "../../auth/auth.guard";
import { CompanyId } from "../../common/company-id.decorator";
import { pgMessage } from "../../common/company.util";

const RECORD_TYPES = ["invoice", "bill", "expense", "item", "customer", "supplier"] as const;
type RecordType = (typeof RECORD_TYPES)[number];

class RestoreDto {
  @ApiProperty({ enum: RECORD_TYPES }) @IsIn(RECORD_TYPES) type!: RecordType;
  @ApiProperty() @IsUUID() id!: string;
}

@Injectable({ scope: Scope.REQUEST })
class RecycleBinService {
  constructor(@Inject(REQUEST_SUPABASE) private readonly db: SupabaseClient) {}

  async list(companyId: string) {
    const { data, error } = await this.db.rpc("recycle_bin", { p_company: companyId });
    if (error) throw new BadRequestException(pgMessage(error));
    return data ?? [];
  }

  async restore(type: RecordType, id: string) {
    const { error } = await this.db.rpc("restore_record", { p_type: type, p_id: id });
    if (error) throw new BadRequestException(pgMessage(error));
  }

  async purge(type: RecordType, id: string) {
    const { error } = await this.db.rpc("purge_record", { p_type: type, p_id: id });
    if (error) throw new BadRequestException(pgMessage(error));
  }
}

@ApiTags("recycle-bin")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("recycle-bin")
class RecycleBinController {
  constructor(private readonly svc: RecycleBinService) {}
  @Get() list(@CompanyId() c: string) { return this.svc.list(c); }
  @Post("restore") restore(@Body() dto: RestoreDto) { return this.svc.restore(dto.type, dto.id); }
  @Delete(":type/:id") @HttpCode(204) purge(@Param("type") type: RecordType, @Param("id") id: string) {
    if (!RECORD_TYPES.includes(type)) throw new BadRequestException("Unknown record type");
    return this.svc.purge(type, id);
  }
}

@Module({ controllers: [RecycleBinController], providers: [RecycleBinService, AuthGuard] })
export class RecycleBinModule {}
