import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { PrismaService } from './common/prisma/prisma.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Meta signs the exact bytes it sent, so the raw body must survive parsing.
    rawBody: true,
  });

  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  configureApp(app);

  if (config.get<string>('env') !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Aqar Network API')
        .setDescription('Multi-tenant real-estate network operated over WhatsApp')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document);
  }

  app.get(PrismaService).enableShutdownHooks(app);
  app.enableShutdownHooks();

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`Aqar Network listening on port ${port}`);
}

void bootstrap();
