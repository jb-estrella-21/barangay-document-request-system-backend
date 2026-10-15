import { createHmac } from 'node:crypto';
import { clientIpForRateLimit, ProxyMetadataRequest, verifiedProxyClientIp } from './proxy-client-ip';

const secret = Buffer.alloc(32, 9);
const nowMs = 1_800_000_000_000;
const path = '/api/v1/requests';

function signedHeaders(ip: string, timestamp = String(Math.floor(nowMs / 1000)), method = 'POST', requestPath = path) {
  const message = ['v1', timestamp, ip, method.toUpperCase(), requestPath].join('\n');
  return {
    'x-proxy-client-ip': ip,
    'x-proxy-client-ip-timestamp': timestamp,
    'x-proxy-client-ip-signature': createHmac('sha256', secret).update(message).digest('hex'),
  };
}

function request(headers: ProxyMetadataRequest['headers'] = {}, overrides: Partial<ProxyMetadataRequest> = {}): ProxyMetadataRequest {
  return { headers, method: 'POST', path, ip: '203.0.113.10', ...overrides };
}

describe('signed Pages client IP metadata', () => {
  it('accepts a valid versioned HMAC for rate-limit tracking', () => {
    const input = request(signedHeaders('198.51.100.20'));
    expect(verifiedProxyClientIp(input, secret, nowMs)).toBe('198.51.100.20');
    expect(clientIpForRateLimit(input, secret, nowMs)).toBe('198.51.100.20');
  });

  it('rejects bad signatures, invalid IPs, malformed timestamps, and expired or future timestamps', () => {
    const valid = signedHeaders('198.51.100.20');
    expect(verifiedProxyClientIp(request({ ...valid, 'x-proxy-client-ip-signature': '0'.repeat(64) }), secret, nowMs)).toBeNull();
    expect(verifiedProxyClientIp(request(signedHeaders('not-an-ip')), secret, nowMs)).toBeNull();
    expect(verifiedProxyClientIp(request({ ...valid, 'x-proxy-client-ip-timestamp': 'yesterday' }), secret, nowMs)).toBeNull();
    expect(verifiedProxyClientIp(request(signedHeaders('198.51.100.20', String(Math.floor(nowMs / 1000) - 61))), secret, nowMs)).toBeNull();
    expect(verifiedProxyClientIp(request(signedHeaders('198.51.100.20', String(Math.floor(nowMs / 1000) + 61))), secret, nowMs)).toBeNull();
  });

  it('rejects missing metadata and ignores forged forwarding headers when falling back', () => {
    const direct = request({
      'x-forwarded-for': '198.51.100.99',
      'x-real-ip': '198.51.100.98',
    });
    expect(verifiedProxyClientIp(direct, secret, nowMs)).toBeNull();
    expect(clientIpForRateLimit(direct, secret, nowMs)).toBe('203.0.113.10');
    expect(clientIpForRateLimit(request({}, { ip: '192.0.2.8' }), null, nowMs)).toBe('192.0.2.8');
  });

  it('binds signatures to method and path and keeps a replay in the same IP bucket only within the time window', () => {
    const metadata = signedHeaders('198.51.100.20');
    expect(verifiedProxyClientIp(request(metadata, { method: 'GET' }), secret, nowMs)).toBeNull();
    expect(verifiedProxyClientIp(request(metadata, { path: '/api/v1/staff/auth/me' }), secret, nowMs)).toBeNull();

    const captured = request(metadata);
    const replayed = request(metadata, { ip: '203.0.113.77' });
    expect(clientIpForRateLimit(captured, secret, nowMs)).toBe('198.51.100.20');
    expect(clientIpForRateLimit(replayed, secret, nowMs + 30_000)).toBe('198.51.100.20');
    expect(verifiedProxyClientIp(replayed, secret, nowMs + 61_000)).toBeNull();
  });
});
