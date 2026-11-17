import crypto from 'node:crypto';
import type { AccountStatus, RegisteredUser, UserRole } from '../src/types.ts';

export interface StoredUser extends RegisteredUser {
  passwordHash: string;
}

export interface JwtClaims {
  sub: string;
  email: string;
  role: UserRole;
  status: AccountStatus;
  iat: number;
  exp: number;
}

const JWT_SECRET =
  process.env.JWT_SECRET || 'komo-services-libreville-jwt-secret-key-2026';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, originalHex] = parts;
  if (!salt || !originalHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(originalHex, 'hex');
  if (derived.length !== original.length) return false;
  return crypto.timingSafeEqual(derived, original);
}

function toBase64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromBase64Url(input: string): string {
  const padLen = (4 - (input.length % 4)) % 4;
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
  return Buffer.from(padded, 'base64').toString('utf8');
}

export function signJwt(user: Pick<RegisteredUser, 'id' | 'email' | 'role' | 'status'>): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = toBase64Url(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      iat: nowSec,
      exp: nowSec + 7 * 24 * 60 * 60, // 7 days
    } satisfies JwtClaims)
  );
  const signingInput = `${header}.${payload}`;
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(signingInput)
    .digest();
  return `${signingInput}.${toBase64Url(signature)}`;
}

export function verifyJwt(token: string): JwtClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, sigB64] = parts;
    const signingInput = `${header}.${payload}`;
    const expectedSig = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(signingInput)
      .digest();
    const expectedB64 = toBase64Url(expectedSig);
    const a = Buffer.from(sigB64);
    const b = Buffer.from(expectedB64);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }
    const claims = JSON.parse(fromBase64Url(payload)) as JwtClaims;
    if (!claims.sub || !claims.exp || claims.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

export function sanitizeUser(user: StoredUser): RegisteredUser {
  const { passwordHash: _omit, ...safeUser } = user;
  return safeUser;
}
