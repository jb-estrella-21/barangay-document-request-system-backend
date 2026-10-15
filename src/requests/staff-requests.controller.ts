import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpException, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentStaff } from '../common/auth.decorators';
import { StaffPrincipal } from '../common/auth.types';
import { CsrfGuard } from '../common/guards/csrf.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { StaffSessionGuard } from '../common/guards/staff-session.guard';
import { RequestQueueQuery, RequestQueueSearchDto, ReleaseDateDto, TransitionRequestDto } from './staff-requests.dto';
import { StaffRequestsService } from './staff-requests.service';
import { ApiJsonResponse, ApiProblemResponses, ApiStaffCsrfHeaders, schemas } from '../common/openapi';

@ApiTags('staff requests')
@ApiCookieAuth()
@Controller('staff')
@UseGuards(StaffSessionGuard, CsrfGuard, RolesGuard)
export class StaffRequestsController {
  constructor(private readonly requests: StaffRequestsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Get request queue counts', description: 'Available to processors and administrators with a staff session.' })
  @ApiJsonResponse(200, 'Current counts for pending, processing, ready, and overdue requests.', schemas.summary)
  @ApiProblemResponses({ status: 401, description: 'Staff authentication is required.' }, { status: 429, description: 'Global rate limit exceeded.' }, { status: 500, description: 'Unexpected API failure.' })
  summary() { return this.requests.summary(); }

  @Get('requests')
  @ApiOperation({ summary: 'List the request queue', description: 'Available to processors and administrators. Supports status, documentTypeId, release-date range, overdue, limit, and cursor. Search is not accepted in a URL; use POST /staff/requests/search for applicant or reference search.' })
  @ApiJsonResponse(200, 'Queue page in stable newest-first order.', schemas.page(schemas.staffQueueItem))
  @ApiProblemResponses({ status: 400, description: 'Invalid filter, date, cursor, or unknown query field (including search).' }, { status: 401, description: 'Staff authentication is required.' }, { status: 403, description: 'Staff role or password-change requirement prevents access.' }, { status: 429, description: 'Global rate limit exceeded.' }, { status: 500, description: 'Unexpected API failure.' })
  list(@Query() query: RequestQueueQuery) { return this.requests.list(query); }

  @Post('requests/search')
  @HttpCode(200)
  @ApiOperation({ summary: 'Search the request queue using filters in a JSON body', description: 'Available to processors and administrators with a staff session. Search matches request reference, applicant full name, or contact number. Because this is a POST, it requires the configured Origin and a valid session-bound CSRF token.' })
  @ApiStaffCsrfHeaders()
  @ApiBody({ type: RequestQueueSearchDto, required: true })
  @ApiJsonResponse(200, 'Filtered queue page in stable newest-first order.', schemas.page(schemas.staffQueueItem))
  @ApiProblemResponses({ status: 400, description: 'Invalid filters, cursor, or search field.' }, { status: 401, description: 'Staff authentication is required.' }, { status: 403, description: 'Staff role, Origin, or CSRF verification failed.' }, { status: 413, description: 'Request body exceeds 100 KB.' }, { status: 429, description: 'Global rate limit exceeded.' }, { status: 500, description: 'Unexpected API failure.' })
  search(@Body() query: RequestQueueSearchDto) { return this.requests.list(query); }

  @Get('requests/:id')
  @ApiOperation({ summary: 'Get full request details and status history', description: 'Available to processors and administrators. Includes applicant details, submitted field values, staff notes, and pinned document configuration; never includes the tracking credential hash. Returns an ETag containing the current request version.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiJsonResponse(200, 'Full staff request details and history.', schemas.requestDetail, { ETag: { description: 'Quoted optimistic concurrency version, for example "3".', schema: { type: 'string' } } })
  @ApiProblemResponses({ status: 401, description: 'Staff authentication is required.' }, { status: 403, description: 'Staff role or password-change requirement prevents access.' }, { status: 404, description: 'Request not found.' }, { status: 429, description: 'Global rate limit exceeded.' }, { status: 500, description: 'Unexpected API failure.' })
  async get(@Param('id', new ParseUUIDPipe()) id: string, @Res({ passthrough: true }) response: Response) {
    const request = await this.requests.get(id);
    response.setHeader('ETag', `"${request.version}"`);
    return request;
  }

  @Post('requests/:id/transitions')
  @ApiHeader({ name: 'If-Match', required: true, description: 'Current version from the ETag response header, normally a quoted integer such as "3". Weak or bare integer forms are also accepted.' })
  @ApiOperation({ summary: 'Apply an allowed request status transition', description: 'Available to processors and administrators. Send the current request ETag in If-Match. Rejection and cancellation require both reason and publicMessage; internalNote remains private. Success increments the version.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiStaffCsrfHeaders()
  @ApiBody({ type: TransitionRequestDto })
  @ApiJsonResponse(201, 'Transition applied.', schemas.transitionResult)
  @ApiProblemResponses({ status: 400, description: 'Invalid body, missing rejection/cancellation reason or public message, or malformed If-Match.' }, { status: 401, description: 'Staff authentication is required.' }, { status: 403, description: 'Staff role, Origin, or CSRF verification failed.' }, { status: 404, description: 'Request not found.' }, { status: 409, description: 'Stale version or invalid lifecycle transition.' }, { status: 413, description: 'Request body exceeds 100 KB.' }, { status: 428, description: 'If-Match is required.' }, { status: 429, description: 'Global rate limit exceeded.' }, { status: 500, description: 'Unexpected API failure.' })
  transition(@CurrentStaff() staff: StaffPrincipal, @Param('id', new ParseUUIDPipe()) id: string, @Headers('if-match') etag: string | undefined, @Body() dto: TransitionRequestDto) {
    return this.requests.transition(staff.id, id, parseEtag(etag), dto);
  }

  @Patch('requests/:id/release-date')
  @ApiHeader({ name: 'If-Match', required: true, description: 'Current version from the ETag response header, normally a quoted integer such as "3". Weak or bare integer forms are also accepted.' })
  @ApiOperation({ summary: 'Set or revise an expected release date', description: 'Available to processors and administrators before pickup readiness or closure. Use YYYY-MM-DD interpreted in Asia/Manila. A reason is required when changing a previously set date. A changed date increments the version; repeating the current date leaves the version unchanged.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiStaffCsrfHeaders()
  @ApiBody({ type: ReleaseDateDto })
  @ApiJsonResponse(200, 'Expected release date updated.', schemas.releaseDateResult)
  @ApiProblemResponses({ status: 400, description: 'Invalid or past date, missing revision reason, or malformed If-Match.' }, { status: 401, description: 'Staff authentication is required.' }, { status: 403, description: 'Staff role, Origin, or CSRF verification failed.' }, { status: 404, description: 'Request not found.' }, { status: 409, description: 'Stale version or request already ready/closed.' }, { status: 413, description: 'Request body exceeds 100 KB.' }, { status: 428, description: 'If-Match is required.' }, { status: 429, description: 'Global rate limit exceeded.' }, { status: 500, description: 'Unexpected API failure.' })
  releaseDate(@CurrentStaff() staff: StaffPrincipal, @Param('id', new ParseUUIDPipe()) id: string, @Headers('if-match') etag: string | undefined, @Body() dto: ReleaseDateDto) {
    return this.requests.updateReleaseDate(staff.id, id, parseEtag(etag), dto);
  }
}

function parseEtag(value?: string): number {
  if (!value) throw new HttpException('If-Match is required', 428);
  const normalized = value.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 1) throw new BadRequestException('If-Match must contain a request version');
  return parsed;
}
