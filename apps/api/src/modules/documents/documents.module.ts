import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Module,
  NotFoundException, Param, ParseUUIDPipe, Post, Scope, UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString } from "class-validator";
import { SupabaseClient } from "@supabase/supabase-js";
import type { InvoiceDocument } from "@ebizz/shared";
import { REQUEST_SUPABASE } from "../../supabase/supabase.module";
import { AuthGuard } from "../../auth/auth.guard";
import { pgMessage } from "../../common/company.util";

/** Metadata recorded after the browser uploads the file bytes to Storage. */
class CreateDocumentDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty({ description: "Storage object path: {org}/{invoice}/{uuid}-{file}" }) @IsString() storage_path!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() mime?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() size?: number;
}

@Injectable({ scope: Scope.REQUEST })
class DocumentsService {
  constructor(@Inject(REQUEST_SUPABASE) private readonly db: SupabaseClient) {}

  async listForInvoice(invoiceId: string): Promise<InvoiceDocument[]> {
    const { data, error } = await this.db
      .from("documents").select("*").eq("invoice_id", invoiceId).order("created_at", { ascending: false });
    if (error) throw new BadRequestException(pgMessage(error));
    return (data ?? []) as InvoiceDocument[];
  }

  async create(invoiceId: string, dto: CreateDocumentDto): Promise<InvoiceDocument> {
    const { data: inv, error: invErr } = await this.db
      .from("sales_invoices").select("organization_id, company_id").eq("id", invoiceId).maybeSingle();
    if (invErr) throw new BadRequestException(pgMessage(invErr));
    if (!inv) throw new NotFoundException("Invoice not found");
    const i = inv as { organization_id: string; company_id: string };
    const { data, error } = await this.db.from("documents").insert({
      organization_id: i.organization_id, company_id: i.company_id, invoice_id: invoiceId,
      name: dto.name, mime: dto.mime ?? null, size: dto.size ?? null, storage_path: dto.storage_path,
    }).select("*").single();
    if (error) throw new BadRequestException(pgMessage(error));
    return data as InvoiceDocument;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db.from("documents").delete().eq("id", id);
    if (error) throw new BadRequestException(pgMessage(error));
  }
}

@ApiTags("documents")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller()
class DocumentsController {
  constructor(private readonly svc: DocumentsService) {}
  @Get("invoices/:id/documents") list(@Param("id", ParseUUIDPipe) id: string) { return this.svc.listForInvoice(id); }
  @Post("invoices/:id/documents") create(@Param("id", ParseUUIDPipe) id: string, @Body() dto: CreateDocumentDto) { return this.svc.create(id, dto); }
  @Delete("documents/:id") @HttpCode(204) remove(@Param("id", ParseUUIDPipe) id: string) { return this.svc.remove(id); }
}

@Module({ controllers: [DocumentsController], providers: [DocumentsService, AuthGuard] })
export class DocumentsModule {}
