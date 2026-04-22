import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3001);
  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';

  app.enableCors({
    origin: [webOrigin]
  });

  await app.listen(port);
}

void bootstrap();
