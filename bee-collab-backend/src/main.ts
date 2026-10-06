import 'dotenv/config'; // must run before modules that read process.env at import time
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { getAllowedOrigins } from './common/cors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global response interceptor — wraps all success responses in ApiResponse envelope
  app.useGlobalInterceptors(new ResponseInterceptor());

  // Global exception filter — formats all errors in the same ApiResponse envelope
  app.useGlobalFilters(new HttpExceptionFilter());

  // Enable CORS for frontend clients
  app.enableCors({
    origin: getAllowedOrigins(),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ── Swagger / OpenAPI ────────────────────────────────────────────────────────
  const swaggerConfig = new DocumentBuilder()
    .setTitle('BeeCollab API')
    .setDescription(
      'REST API for BeeCollab — a real-time P2P video meeting platform.\n\n' +
      'All endpoints return a consistent **ApiResponse** envelope:\n' +
      '```json\n' +
      '{ "success": true, "data": <payload>, "message": "Success", "timestamp": "...", "path": "..." }\n' +
      '```\n' +
      'Errors follow the same shape with `"success": false` and an `"error"` field.\n\n' +
      'Protected endpoints require a **Bearer JWT** token from `POST /auth/login`.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
      'JWT',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
  // ─────────────────────────────────────────────────────────────────────────────

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 BeeCollab Backend is running on: http://localhost:${port}`);
  console.log(`📄 Swagger docs available at: http://localhost:${port}/api/docs`);
}

void bootstrap();
