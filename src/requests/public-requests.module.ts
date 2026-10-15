import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { PublicRequestsController } from './public-requests.controller';
import { PublicRequestsService } from './public-requests.service';
import { SubmissionResponseCleaner } from './submission-response-cleaner.service';

@Module({ imports: [CatalogModule], controllers: [PublicRequestsController], providers: [PublicRequestsService, SubmissionResponseCleaner] })
export class PublicRequestsModule {}
