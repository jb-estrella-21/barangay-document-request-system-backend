import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { normalizeIp } from '@nestjs/throttler';

export type ProxyMetadataRequest = {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  path: string;
  ip?: string;
};

const HEADER_CLIENT_IP = 'x-proxy-client-ip';
const HEADER_TIMESTAMP = 'x-proxy-client-ip-timestamp';
const HEADER_SIGNATURE = 'x-proxy-client-ip-signature';

function readHeader(request: ProxyMetadataRequest, name: string): string | null {
  const value = request.headers[name];
  return typeof value === 'string' ? value : null;
}

/**
 * Verifies Pages proxy metadata for rate-limit attribution only.
 * A valid signature is not an authentication or authorization credential.
 */
export function verifiedProxyClientIp(
  request: ProxyMetadataRequest,
  secret: Buffer | null,
  nowMs = Date.now(),
): string | null {
  if (!secret || secret.length !== 32) return null;

  const ip = readHeader(request, HEADER_CLIENT_IP);
  const timestamp = readHeader(request, HEADER_TIMESTAMP);
  const signature = readHeader(request, HEADER_SIGNATURE);
  if (!ip || isIP(ip) === 0 || !timestamp || !/^(?:0|[1-9]\d{0,10})$/.test(timestamp)) return null;
  if (!signature || !/^[a-f0-9]{64}$/.test(signature)) return null;

  const issuedAt = Number(timestamp);
  if (!Number.isSafeInteger(issuedAt) || Math.abs(Math.floor(nowMs / 1000) - issuedAt) > 60) return null;

  const method = request.method.toUpperCase();
  const requestPath = request.path;
  if (!/^[A-Z]{3,10}$/.test(method) || !requestPath.startsWith('/') ||
      requestPath.length > 2048 || /[?#\r\n]/.test(requestPath)) return null;

  const message = ['v1', timestamp, ip, method, requestPath].join('\n');
  const expected = createHmac('sha256', secret).update(message, 'utf8').digest();
  const supplied = Buffer.from(signature, 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  return ip;
}

/** Falls back to Express's address (TRUST_PROXY remains disabled), never raw forwarding headers. */
export function clientIpForRateLimit(
  request: ProxyMetadataRequest,
  secret: Buffer | null,
  nowMs = Date.now(),
): string {
  const signedIp = verifiedProxyClientIp(request, secret, nowMs);
  const tracker = signedIp ?? request.ip ?? '';
  return isIP(tracker) === 0 ? 'unknown' : normalizeIp(tracker);
}
