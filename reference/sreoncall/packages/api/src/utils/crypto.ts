import crypto from 'crypto';

/**
 * Create an HMAC-SHA256 signature for a given payload.
 */
export function createHmacSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

/**
 * Verify an HMAC-SHA256 signature against a given payload.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyHmacSignature(payload: string, secret: string, signature: string): boolean {
  const expected = createHmacSignature(payload, secret);
  const expectedBuf = Buffer.from(expected, 'hex');
  const signatureBuf = Buffer.from(signature, 'hex');

  if (expectedBuf.length !== signatureBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

/**
 * Generate a cryptographically secure random token.
 */
export function generateSecureToken(length = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Hash a string using SHA-256.
 */
export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Generate an API key with a prefix for identification.
 */
export function generateApiKey(prefix = 'soc'): { key: string; hash: string; prefix: string } {
  const randomPart = crypto.randomBytes(32).toString('base64url');
  const key = `${prefix}_${randomPart}`;
  const hash = sha256(key);
  const keyPrefix = key.slice(0, prefix.length + 5);

  return { key, hash, prefix: keyPrefix };
}
