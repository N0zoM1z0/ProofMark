import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { getApiRuntimeConfig } from './config.js';
import {
  createPayloadSizeMiddleware,
  createRateLimitMiddleware,
  createRequestLoggingMiddleware,
  createSecurityHeadersMiddleware
} from './http-hardening.js';
import { PrivacySafeLogger } from './privacy-logger.js';

async function bootstrap() {
  const config = getApiRuntimeConfig();
  const logger = new PrivacySafeLogger(config.logSalt);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    bufferLogs: true
  });

  app.useLogger(logger);
  app.enableShutdownHooks();
  app.useBodyParser('json', {
    limit: config.bodyLimitBytes
  });
  app.useBodyParser('urlencoded', {
    extended: true,
    limit: config.bodyLimitBytes
  });
  app.use(createSecurityHeadersMiddleware(config));
  app.use(createPayloadSizeMiddleware(config));
  app.use(createRateLimitMiddleware(config));
  app.use(createRequestLoggingMiddleware(logger, config));
  app.enableCors({
    origin: config.webOrigins
  });

  await app.listen(config.port);
}

void bootstrap();
