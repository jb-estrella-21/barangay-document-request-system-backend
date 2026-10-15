import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureHttpApplication } from './common/application-setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  const config = configureHttpApplication(app);
  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
