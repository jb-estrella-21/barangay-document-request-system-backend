import { generateRequestId, sanitizeErrorLog, sanitizeRequestLog, sanitizeResponseLog } from './request-logging';
import { routeTemplateFor } from './guards/request-route.guard';

describe('request logging privacy', () => {
  it('retains request diagnostics without serializing URLs, request data, or response headers', () => {
    const responseHeaders = new Map<string, string>();
    const requestId = generateRequestId({}, {
      setHeader: (name, value) => responseHeaders.set(name.toLowerCase(), value),
    });
    const request = {
      id: requestId,
      method: 'POST',
      baseUrl: '/api/v1/staff/base-path-secret-sentinel',
      logRouteTemplate: '/staff/requests/:id',
      route: { path: '/untrusted-fallback-path' },
      url: '/api/v1/staff/requests/tracking-secret-sentinel?search=resident-name-sentinel&contact=contact-sentinel',
      headers: { cookie: 'cookie-secret-sentinel', authorization: 'auth-secret-sentinel' },
      body: { fullName: 'body-name-sentinel', trackingCredential: 'body-secret-sentinel' },
      query: { search: 'query-name-sentinel' },
      params: { id: 'path-secret-sentinel' },
    };
    const response = {
      statusCode: 200,
      headers: { 'set-cookie': 'response-cookie-sentinel', 'x-request-id': requestId },
    };

    const logRecord = {
      req: sanitizeRequestLog(request),
      res: sanitizeResponseLog(response),
      responseTime: 18,
      requestId,
      responseRequestId: responseHeaders.get('x-request-id'),
    };
    const serialized = JSON.stringify(logRecord);

    expect(logRecord.req).toEqual({ id: requestId, method: 'POST', route: '/staff/requests/:id' });
    expect(logRecord.res).toEqual({ statusCode: 200 });
    expect(logRecord.responseTime).toBe(18);
    expect(logRecord.responseRequestId).toBe(requestId);
    for (const secret of [
      'tracking-secret-sentinel', 'resident-name-sentinel', 'contact-sentinel', 'cookie-secret-sentinel',
      'auth-secret-sentinel', 'body-name-sentinel', 'body-secret-sentinel', 'query-name-sentinel',
      'path-secret-sentinel', 'base-path-secret-sentinel', 'response-cookie-sentinel',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('uses a safe fallback route for requests without a matched route template', () => {
    expect(sanitizeRequestLog({ id: 'id', method: 'GET', url: '/secret/path-value?search=resident' })).toEqual({
      id: 'id', method: 'GET', route: '/<unmatched>',
    });
  });

  it('builds a route template from Nest route metadata and rejects unsafe metadata', () => {
    expect(routeTemplateFor('staff', 'requests/:id')).toBe('/staff/requests/:id');
    expect(routeTemplateFor('staff', 'requests/:name?search=private')).toBe('/<unmatched>');
  });

  it('keeps sensitive exception messages and stacks out of access logs', () => {
    const error = Object.assign(new Error('tracking-credential-sentinel'), {
      stack: 'applicant-name-sentinel',
    });
    expect(JSON.stringify(sanitizeErrorLog(error))).toBe('{"type":"Error"}');
  });
});
