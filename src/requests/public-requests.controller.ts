import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PublicRequestsService } from './public-requests.service';
import { CreatePublicRequestDto, TrackRequestDto } from './public-requests.dto';
import { ApiJsonResponse, ApiProblemResponses, schemas } from '../common/openapi';

@ApiTags('public requests')
@Controller('requests')
export class PublicRequestsController {
  constructor(private readonly requests: PublicRequestsService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Submit an anonymous document request',
    description: 'Validates applicant values against the selected active document type version. Limit: 5 submissions per client IP per minute. Reuse the same idempotency key only to retry the same submission; the tracking credential is returned only in this response and valid same-key retries for 24 hours.',
  })
  @ApiBody({ type: CreatePublicRequestDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: '16–200 characters. Reuse the same key and identical JSON body to replay a submission safely.' })
  @ApiJsonResponse(201, 'Request created; save both the reference and tracking credential.', schemas.submission)
  @ApiProblemResponses(
    { status: 400, description: 'Invalid body, missing/invalid idempotency key, or document-specific values.' },
    { status: 404, description: 'The selected document type is unavailable.' },
    { status: 409, description: 'Key reused for different content, expired replay response, or reference conflict.' },
    { status: 413, description: 'Request body exceeds 100 KB.' },
    { status: 429, description: 'Public submission rate limit exceeded.' },
    { status: 500, description: 'Unexpected API failure.' },
  )
  submit(@Body() dto: CreatePublicRequestDto, @Headers('idempotency-key') key?: string) {
    return this.requests.submit(dto, key ?? '');
  }

  @Post('track')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Check a request using its reference and private tracking credential', description: 'Accepts both credentials in the request body. Limit: 20 tracking attempts per client IP per minute. Invalid pairs use the same 404 response and do not reveal whether a reference exists. Applicant and staff-only data are not returned.' })
  @ApiBody({ type: TrackRequestDto })
  @ApiJsonResponse(200, 'Resident-visible progress for the matching credentials.', schemas.trackedRequest)
  @ApiProblemResponses(
    { status: 400, description: 'Invalid request body.' },
    { status: 404, description: 'Request reference and tracking credential did not match.' },
    { status: 413, description: 'Request body exceeds 100 KB.' },
    { status: 429, description: 'Tracking rate limit exceeded.' },
    { status: 500, description: 'Unexpected API failure.' },
  )
  track(@Body() dto: TrackRequestDto) { return this.requests.track(dto.reference, dto.trackingCredential); }
}
