import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import prisma from './prisma';
import { UserRole } from '@/types';

const DEV_ONLY_JWT_SECRET = 'local-development-only-jwt-secret-not-for-production';
const MIN_JWT_SECRET_LENGTH = 32;

/**
 * JWT signing secret. Production must provide JWT_SECRET (at least 32 characters);
 * the development fallback is never used when NODE_ENV is production.
 */
export function getJwtSecret(): Uint8Array {
  const secretKey = process.env.JWT_SECRET?.trim();
  if (secretKey) {
    if (process.env.NODE_ENV === 'production' && secretKey.length < MIN_JWT_SECRET_LENGTH) {
      throw new Error(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters in production.`);
    }
    return new TextEncoder().encode(secretKey);
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is not set. Refusing to sign or verify sessions in production.');
  }
  return new TextEncoder().encode(DEV_ONLY_JWT_SECRET);
}

export const TOKEN_COOKIE_NAME = 'school_auth_token';

export interface TokenPayload {
  userId: string;
  email: string;
  role: UserRole;
  name: string;
  parentId?: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getJwtSecret());
}

export async function verifySessionToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return payload as unknown as TokenPayload;
  } catch {
    return null;
  }
}

/**
 * `throwOnUnavailable`: a database failure throws instead of returning null. Only /api/auth/me uses
 * it, so a short outage is reported as an error (the app keeps the session) rather than as "signed
 * out". Every other caller still fails closed.
 */
export async function getCurrentUser(req?: Request, { throwOnUnavailable = false } = {}) {
  let token: string | undefined;

  try {
    const cookieStore = await cookies();
    token = cookieStore.get(TOKEN_COOKIE_NAME)?.value;
  } catch {
    // cookies() might throw outside request lifecycle or in test scripts
  }

  if (!token && req) {
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    }
  }

  if (!token) return null;

  return resolveSessionUser(token, loadUserById, { throwOnUnavailable });
}

function loadUserById(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      parent: {
        include: {
          students: {
            where: { isActive: true },
            orderBy: { name: 'asc' },
          },
        },
      },
    },
  });
}

/**
 * The token only identifies the user. Role and parent link always come from the database,
 * so deleted or demoted accounts lose access immediately instead of when the token expires.
 */
export async function resolveSessionUser(
  token: string,
  loadUser: (userId: string) => Promise<any> = loadUserById,
  { throwOnUnavailable = false } = {}
) {
  const payload = await verifySessionToken(token);
  if (!payload?.userId) return null;

  let user: any = null;
  try {
    user = await loadUser(payload.userId);
  } catch (err) {
    // Fail closed: without a database answer the session cannot be trusted.
    console.error('[Auth] Could not load session user:', err instanceof Error ? err.message : err);
    if (throwOnUnavailable) throw err;
    return null;
  }

  return toSessionUser(user);
}

/**
 * Builds the session user from the database record. Returns null for missing (deleted) users
 * and users without a recognised role.
 */
export function toSessionUser(user: any) {
  if (!user || !['PARENT', 'STAFF', 'ADMIN'].includes(user.role)) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    role: user.role as UserRole,
    parentId: user.parent?.id,
    students: user.parent?.students ?? [],
  };
}
