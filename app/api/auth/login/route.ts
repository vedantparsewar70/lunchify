import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import prisma from '@/lib/prisma';
import { comparePassword, hashPassword, createSessionToken, TOKEN_COOKIE_NAME } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rate-limiter';
import { clearLoginFailures, getTrustedClientIp, loginLockRemainingMs, recordLoginFailure } from '@/lib/login-throttle';
import { UserRole } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A bcrypt hash (same cost as real passwords) of a random value nobody knows. Unknown emails are
 * checked against it so they take as long as a wrong password for a real account.
 */
const DUMMY_PASSWORD_HASH = '$2b$10$xghznrBGRB84bf2kaErBL.k3rZd4ids8W5QfXWmMrbf6YbvVuhD/u';

/** Constant-time comparison for the configured staff/admin passwords. */
function matchesSecret(input: unknown, secret: string): boolean {
  const digest = (value: string) => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(digest(String(input ?? '')), digest(secret));
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function POST(req: Request) {
  let step = '1_REQUEST_RECEIVED';
  let redactedEmail = '';

  try {
    const clientIp = getClientIp(req);
    const rateLimit = checkRateLimit(`auth_login_${clientIp}`, { windowMs: 60000, maxRequests: 25 });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please wait a minute and try again.' },
        { status: 429 }
      );
    }

    step = '2_PARSE_BODY';
    const body = await req.json().catch(() => null);
    const { email, password, requestedRole } = body || {};

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const emailStr = String(email).trim().toLowerCase();
    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!EMAIL_REGEX.test(emailStr)) {
      return NextResponse.json(
        { error: 'Please enter a valid email address' },
        { status: 400 }
      );
    }
    const atIndex = emailStr.indexOf('@');
    if (atIndex > 1) {
      redactedEmail = `${emailStr[0]}***${emailStr[atIndex - 1]}${emailStr.slice(atIndex)}`;
    } else {
      redactedEmail = '***@' + (emailStr.split('@')[1] || 'domain');
    }

    const envAdminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const envAdminPass = process.env.ADMIN_PASS;
    const isAdminEnvMatch = Boolean(envAdminEmail && envAdminPass && emailStr === envAdminEmail && matchesSecret(password, envAdminPass));

    const envStaffEmail = process.env.STAFF_EMAIL?.trim().toLowerCase();
    const envStaffPass = process.env.STAFF_PASS;
    const isStaffEnvMatch = Boolean(envStaffEmail && envStaffPass && emailStr === envStaffEmail && matchesSecret(password, envStaffPass));

    step = '3_DATABASE_CHECK';
    // Shared limit per account and client IP (works across server instances, unlike the per-IP
    // limiter above). A lock from one network never blocks the same account on another.
    const throttleIp = getTrustedClientIp(req);
    if ((await loginLockRemainingMs(emailStr, throttleIp)) > 0) {
      return NextResponse.json(
        { error: 'Too many failed attempts. Please wait 15 minutes and try again.' },
        { status: 429 }
      );
    }

    step = '4_USER_LOOKUP';
    let user: any = null;
    try {
      user = await prisma.user.findUnique({
        where: { email: emailStr },
        include: { parent: true },
      });
    } catch (lookupError) {
      // A failed lookup is not "no such user": reporting it as invalid credentials hides database
      // outages, and auto-provisioning below could overwrite an account that does exist.
      console.error(
        '[AUTH_LOGIN_ERROR] User lookup failed:',
        lookupError instanceof Error ? lookupError.name : 'UnknownError'
      );
      return NextResponse.json(
        { error: 'Login is temporarily unavailable. Please try again shortly.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // Auto-provision or sync admin account if env matches.
    // If an account with this email already exists (e.g. someone registered it before the
    // first admin login), its password is reset to the configured one when promoting it,
    // so whoever registered it cannot log in to the elevated account with their own password.
    if (isAdminEnvMatch && envAdminPass && envAdminEmail) {
      if (!user) {
        const passwordHash = await hashPassword(envAdminPass);
        user = await prisma.user.create({
          data: {
            id: 'usr_canteen_admin_01',
            email: envAdminEmail,
            name: 'Canteen Admin',
            role: 'ADMIN',
            passwordHash,
          },
        });
      } else if (user.role !== 'ADMIN' || !(await comparePassword(envAdminPass, user.passwordHash || ''))) {
        const passwordHash = await hashPassword(envAdminPass);
        const updatedAt = new Date().toISOString();
        user = await prisma.user.upsert({
          where: { id: user.id },
          update: { role: 'ADMIN', passwordHash, updatedAt },
          create: { ...user, role: 'ADMIN', passwordHash },
        });
      }
    }

    // Auto-provision or sync staff account if env matches (same takeover protection as admin)
    if (isStaffEnvMatch && envStaffPass && envStaffEmail) {
      if (!user) {
        const passwordHash = await hashPassword(envStaffPass);
        user = await prisma.user.create({
          data: {
            id: 'usr_canteen_staff_01',
            email: envStaffEmail,
            name: 'Canteen Staff',
            role: 'STAFF',
            passwordHash,
          },
        });
      } else if (
        (user.role !== 'STAFF' && user.role !== 'ADMIN') ||
        !(await comparePassword(envStaffPass, user.passwordHash || ''))
      ) {
        const passwordHash = await hashPassword(envStaffPass);
        const role = user.role === 'ADMIN' ? 'ADMIN' : 'STAFF';
        const updatedAt = new Date().toISOString();
        user = await prisma.user.upsert({
          where: { id: user.id },
          update: { role, passwordHash, updatedAt },
          create: { ...user, role, passwordHash },
        });
      }
    }

    if (!user) {
      // Same work as a wrong password, so response time does not reveal which emails have accounts.
      await comparePassword(String(password), DUMMY_PASSWORD_HASH);
      await recordLoginFailure(emailStr, throttleIp, redactedEmail);
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // The password is checked before the role, so a wrong password never reveals which kind of
    // account an email belongs to.
    step = '5_PASSWORD_VERIFY';
    let isValid = false;
    if (isAdminEnvMatch || isStaffEnvMatch) {
      isValid = true;
    } else {
      isValid = await comparePassword(String(password), user.passwordHash || DUMMY_PASSWORD_HASH);
      if (!user.passwordHash) isValid = false;
    }

    if (!isValid) {
      await recordLoginFailure(emailStr, throttleIp, redactedEmail);
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }
    await clearLoginFailures(emailStr, throttleIp);

    // Role-specific enforcement if requestedRole is provided
    if (requestedRole === 'admin' && user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Access denied: This login is reserved for Administrators. If you are Canteen Staff, please use Staff Login.' },
        { status: 403 }
      );
    }

    if (requestedRole === 'staff' && user.role !== 'STAFF' && user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Access denied: This login is reserved for Canteen Staff.' },
        { status: 403 }
      );
    }

    step = '6_JWT_GENERATION';
    const token = await createSessionToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role as UserRole,
      parentId: user.parent?.id,
    });

    step = '7_SESSION_COOKIE';
    const proto = req.headers.get('x-forwarded-proto') || (req.url.startsWith('https://') ? 'https' : 'http');
    const isHttps = proto === 'https';

    // Safely attempt next/headers cookie store
    try {
      const cookieStore = await cookies();
      cookieStore.set(TOKEN_COOKIE_NAME, token, {
        httpOnly: true,
        secure: isHttps,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7, // 7 days
      });
    } catch {
      // Cookie header fallback applied below
    }

    const redirectUrl =
      user.role === 'ADMIN'
        ? '/admin/dashboard'
        : user.role === 'STAFF'
        ? '/staff/kitchen'
        : '/parent/children';

    const response = NextResponse.json(
      {
        success: true,
        redirectUrl,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          parentId: user.parent?.id,
        },
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );

    // Also attach cookie directly to the response object for bulletproof header delivery across all environments
    response.cookies.set({
      name: TOKEN_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: isHttps,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (error: unknown) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const rawErrorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = (error as { code?: string })?.code;

    // Sanitize any credentials, connection strings, or secrets from log
    const sanitizedError = rawErrorMessage
      .replace(/(password|secret|key|token)=[^& ]+/gi, '$1=***')
      .replace(/:\/\/.*@/g, '://***@');

    console.error('[AUTH_LOGIN_ERROR] Execution failed at step:', step, {
      errorName,
      errorCode,
      errorMessage: sanitizedError,
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Details stay in the server log above; the browser only gets a plain message.
    return NextResponse.json(
      { error: 'Login failed due to a server problem. Please try again shortly.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
