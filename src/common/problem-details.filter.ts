import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { ensureResponseRequestId, sanitizeRoute } from './request-logging';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : undefined;
    const payload = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
    const requestId = ensureResponseRequestId(response);
    const validation = Array.isArray(payload.message) ? payload.message : undefined;
    const detail = typeof payload.message === 'string'
      ? payload.message
      : status >= 500 ? 'An unexpected error occurred' : 'The request could not be completed';

    response.status(status).type('application/problem+json').json({
      type: 'about:blank',
      title: typeof payload.error === 'string' ? payload.error : statusTitle(status),
      status,
      detail,
      instance: sanitizeRoute(request),
      requestId,
      ...(validation ? { errors: validation } : {}),
      ...(typeof payload.code === 'string' ? { code: payload.code } : {}),
    });
  }
}

function statusTitle(status: number): string {
  switch (status) {
    case 400: return 'Bad Request';
    case 401: return 'Unauthorized';
    case 403: return 'Forbidden';
    case 404: return 'Not Found';
    case 409: return 'Conflict';
    case 428: return 'Precondition Required';
    case 413: return 'Payload Too Large';
    case 429: return 'Too Many Requests';
    default: return status >= 500 ? 'Internal Server Error' : 'Request Failed';
  }
}
