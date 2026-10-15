import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
export const csrfTokenForSession = (sessionToken: string): string => createHmac('sha256', sessionToken).update('staff-csrf-v1').digest('base64url');

export function encryptJson(value: unknown, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptJson<T>(encoded: string, key: Buffer): T {
  const [ivPart, tagPart, ciphertextPart] = encoded.split('.');
  if (!ivPart || !tagPart || !ciphertextPart) throw new Error('Invalid encrypted idempotency response');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextPart, 'base64url')), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext) as T;
}
