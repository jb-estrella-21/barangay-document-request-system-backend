/** Exact-origin check shared by CORS-adjacent browser protections. */
export function isConfiguredOrigin(origin: string, allowedOrigins: readonly string[]): boolean {
  return allowedOrigins.includes(origin);
}

