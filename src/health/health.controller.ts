import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../database/prisma.service';
import { ApiJsonResponse, ApiProblemResponses, schemas } from '../common/openapi';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Check API and database availability', description: 'Unauthenticated liveness check. A database query must succeed.' })
  @ApiJsonResponse(200, 'API and database are available.', schemas.health)
  @ApiProblemResponses({ status: 429, description: 'Global rate limit exceeded.' }, { status: 500, description: 'Database or API failure.' })
  async health(): Promise<{ status: 'ok' }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }
}
