import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import prisma from './prisma';
import { UserRole } from '@/types';

function getJwtSecret(): Uint8Array {
  const secretKey =
    process.env.JWT_SECRET ||
    'super-secure-school-mealbox-jwt-secret-key-2026';
  return new TextEncoder().encode(secretKey);
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

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(TOKEN_COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = await verifySessionToken(token);
  if (!payload?.userId) return null;

  // Ultra-fast path for STAFF and ADMIN (no student/parent queries required)
  if (payload.role === 'STAFF' || payload.role === 'ADMIN') {
    return {
      id: payload.userId,
      email: payload.email,
      name: payload.name,
      phone: null,
      role: payload.role as UserRole,
      parentId: undefined,
      students: [],
    };
  }

  let user: any = null;
  try {
    user = await prisma.user.findUnique({
      where: { id: payload.userId },
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
  } catch {
    // Prisma fallback
  }

  if (!user) {
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
