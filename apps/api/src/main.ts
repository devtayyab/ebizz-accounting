import "reflect-metadata";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Load env from the first .env we find (repo root when run from apps/api, or cwd).
// In Docker the vars come from the environment, so a missing file is fine.
for (const candidate of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(candidate) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(candidate);
    break;
  }
}

import { NestFactory } from "@nestjs/core";
import { ValidationPipe, Logger } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { loadConfig } from "./config/configuration";
import { HttpExceptionFilter } from "./common/http-exception.filter";

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  app.setGlobalPrefix(config.globalPrefix);
  // Allow the configured origins, plus any *.vercel.app deploy and localhost,
  // so Vercel preview/production URLs never trip CORS.
  const allowlist = config.corsOrigin.split(",").map((o) => o.trim()).filter(Boolean);
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl / same-origin / server-to-server
      let host = "";
      try { host = new URL(origin).hostname; } catch { /* malformed */ }
      const ok =
        allowlist.includes(origin) ||
        host === "localhost" ||
        host === "127.0.0.1" ||
        host.endsWith(".vercel.app");
      return cb(ok ? null : new Error(`Origin not allowed by CORS: ${origin}`), ok);
    },
    credentials: true,
  });

  // Reject unknown fields and coerce primitive types on every request body.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Ebizz Accounting API")
    .setDescription(
      "Multi-tenant, multi-currency accounting API with inventory, suppliers and customers.",
    )
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, document);

  await app.listen(config.port);
  new Logger("Bootstrap").log(
    `API listening on http://localhost:${config.port}/${config.globalPrefix} (docs at /docs)`,
  );
}

void bootstrap();
