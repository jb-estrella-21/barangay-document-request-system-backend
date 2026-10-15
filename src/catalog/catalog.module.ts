import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogController } from './catalog.controller';
import { PublicCatalogController } from './public-catalog.controller';
import { CatalogService } from './catalog.service';

@Module({ imports: [AuditModule], controllers: [CatalogController, PublicCatalogController], providers: [CatalogService], exports: [CatalogService] })
export class CatalogModule {}
