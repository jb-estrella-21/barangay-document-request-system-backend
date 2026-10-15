import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { ApiJsonResponse, ApiProblemResponses, schemas } from '../common/openapi';

@ApiTags('public document types')
@Controller('document-types')
export class PublicCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @ApiOperation({ summary: 'List active document types and request requirements', description: 'Returns each active type with its current immutable version, supporting requirements, and allowed applicant fields.' })
  @ApiJsonResponse(200, 'Active document types.', schemas.publicDocumentTypes)
  @ApiProblemResponses({ status: 429, description: 'Global rate limit exceeded.' }, { status: 500, description: 'Unexpected API failure.' })
  list() { return this.catalog.publicList(); }
}
