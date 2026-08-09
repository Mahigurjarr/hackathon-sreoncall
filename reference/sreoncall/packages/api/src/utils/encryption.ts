import crypto from 'crypto';
import { getConfig } from '../config/index';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const config = getConfig();
  const hex = config.COMMS_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('COMMS_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a base64url-encoded string containing IV + authTag + ciphertext.
 */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // IV (12) + authTag (16) + ciphertext
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString('base64url');
}

/**
 * Decrypt a base64url-encoded ciphertext string back to plaintext.
 */
export function decryptToken(ciphertext: string): string {
  const key = getKey();
  const combined = Buffer.from(ciphertext, 'base64url');

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}
