import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from "@nestjs/common";
import type { Request } from "express";

/**
 * Extracts the active company from the `x-company-id` header (falling back to a
 * `companyId` query param). Company-scoped endpoints use this to filter data.
 * RLS still guarantees the user actually belongs to that company's org, so a
 * spoofed id simply returns nothing.
 */
export const CompanyId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const fromHeader = req.headers["x-company-id"];
    const value =
      (Array.isArray(fromHeader) ? fromHeader[0] : fromHeader) ??
      (req.query["companyId"] as string | undefined);
    if (!value) {
      throw new BadRequestException(
        "Missing company context: send an 'x-company-id' header",
      );
    }
    return value;
  },
);
