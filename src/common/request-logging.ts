import { randomUUID } from 'node:crypto';

type RouteDescriptor = { path?: string | string[] };

export type RequestLogInput = {
  id?: string | number;
  method?: string;
  logRouteTemplate?: string;
  route?: RouteDescriptor;
};

export type ResponseLogInput = { statusCode?: number };

export function generateRequestId(
  _request: unknown,
  response: { setHeader(name: string, value: string): unknown },
): string {
  const requestId = randomUUID();
  response.setHeader('x-request-id', requestId);
  return requestId;
}

export function ensureResponseRequestId(response: {
  getHeader?(name: string): number | string | string[] | undefined;
  setHeader(name: string, value: string): unknown;
}): string {
  const existing = response.getHeader?.('x-request-id');
  if (typeof existing === 'string' && existing) return existing;
  const requestId = randomUUID();
  response.setHeader('x-request-id', requestId);
  return requestId;
}

export function sanitizeRequestLog(request: object): Record<string, string> {
  const input = request as RequestLogInput;
  return {
    id: typeof input.id === 'string' || typeof input.id === 'number' ? String(input.id) : 'unknown',
    method: safeMethod(input.method),
    route: sanitizeRouteTemplate(input),
  };
}

export function sanitizeRoute(request: object): string {
  return sanitizeRouteTemplate(request as RequestLogInput);
}

export function sanitizeResponseLog(response: object): { statusCode: number | null } {
  const input = response as ResponseLogInput;
  return { statusCode: Number.isInteger(input.statusCode) ? input.statusCode! : null };
}

export function sanitizeErrorLog(error: object): { type: string } {
  const name = (error as { name?: unknown }).name;
  return { type: typeof name === 'string' && /^[A-Za-z0-9]+$/.test(name) ? name.slice(0, 64) : 'Error' };
}

function sanitizeRouteTemplate(request: RequestLogInput): string {
  if (typeof request.logRouteTemplate === 'string' && /^\/[A-Za-z0-9_./:-]*$/.test(request.logRouteTemplate)) {
    return request.logRouteTemplate;
  }
  const routePath = Array.isArray(request.route?.path) ? request.route?.path[0] : request.route?.path;
  if (typeof routePath !== 'string' || !routePath) return '/<unmatched>';

  const fullPath = routePath.startsWith('/') ? routePath : `/${routePath}`;
  if (!/^\/[A-Za-z0-9_./:-]*$/.test(fullPath)) return '/<unmatched>';
  return fullPath;
}

function safeMethod(method?: string): string {
  return method && /^[A-Z]+$/.test(method) ? method : 'UNKNOWN';
}

