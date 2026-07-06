import "reflect-metadata";
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
  app.enableCors({
    origin: config.corsOrigin.split(",").map((o) => o.trim()),
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
