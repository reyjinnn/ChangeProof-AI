import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

import { ChangeProofError } from '../../core/index.js';

function scryptKey(password: string, salt: Buffer, keyLength: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, keyLength, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (error, derived) => {
      if (error) {
        reject(error);
      } else {
        resolve(derived);
      }
    });
  });
}

/**
 * Server-side password hashing and policy (WP3-28, FR3-38).
 *
 * scrypt from the standard library; no new dependency for credential
 * handling. Only the formatted hash persists — never the password. Policy
 * below is `[DERIVED]` server validation: length-bounded (the 128-char cap
 * bounds hashing work), deliberately not the mockup's eight-character
 * minimum. Verification of a malformed stored hash returns false, never
 * access.
 */

export const PASSWORD_POLICY = {
  minLength: 10,
  maxLength: 128,
} as const;

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

/** Reject unacceptable passwords before any hashing work or user lookup. */
export function assertPasswordAcceptable(password: string): void {
  if (password.length < PASSWORD_POLICY.minLength || password.length > PASSWORD_POLICY.maxLength) {
    throw new ChangeProofError(
      `Password must be ${PASSWORD_POLICY.minLength}..${PASSWORD_POLICY.maxLength} characters; refusing.`,
    );
  }
}

/** Hash an acceptable password. Output format carries its own parameters. */
export async function hashPassword(password: string): Promise<string> {
  assertPasswordAcceptable(password);
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptKey(password, salt, KEY_BYTES);
  return `scrypt$v1$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/**
 * Verify a password against a stored hash. Unknown formats, parameter drift,
 * and length mismatch all verify as false — a broken hash never authenticates.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (
    parts.length !== 7 ||
    parts[0] !== 'scrypt' ||
    parts[1] !== 'v1' ||
    parts[2] !== String(SCRYPT_N) ||
    parts[3] !== String(SCRYPT_R) ||
    parts[4] !== String(SCRYPT_P)
  ) {
    return false;
  }
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[5] ?? '', 'base64url');
    expected = Buffer.from(parts[6] ?? '', 'base64url');
  } catch {
    return false;
  }
  if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) {
    return false;
  }
  const key = await scryptKey(password, salt, KEY_BYTES);
  return key.length === expected.length && timingSafeEqual(key, expected);
}
