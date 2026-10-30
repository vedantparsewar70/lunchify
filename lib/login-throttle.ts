import crypto from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { db } from './firebase-admin';

/**
 * Failed-login limits shared by all server instances (the in-memory per-IP limiter alone resets on
 * every cold start on Vercel).
 *
 * 1. Lock per account AND client IP: after MAX_FAILURES wrong passwords from one IP within WINDOW_MS,
 *    that email is paused for LOCK_MS from that IP only. Someone on another network cannot lock
 *    staff out, and the right password from another IP still works.
 * 2. Account monitor: failures for an email from every IP are counted per hour. At
 *    ACCOUNT_ALERT_FAILURES a server-side security warning is logged once per window. It never
 *    locks the account.
 *
 * Only hashes of the email (and IP) are stored. Every record carries `expiresAt`, a Firestore TTL
 * field: enable TTL on `expiresAt` for both collections so old records are deleted automatically.
 *
 * Throttling fails open: if these collections cannot be read or written, login continues (with a
 * warning in the log) and the normal database password check still decides who gets in.
 */
export const LOGIN_MAX_FAILURES = 10;
export const ACCOUNT_ALERT_FAILURES = 100;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const ACCOUNT_WINDOW_MS = 60 * 60 * 1000;

export const LOGIN_ATTEMPTS = 'login_attempts';
export const LOGIN_ACCOUNT_ACTIVITY = 'login_account_activity';

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const accountKey = (email: string) => sha256(normalizeEmail(email));
const attemptKey = (email: string, ip: string) => sha256(`${normalizeEmail(email)}|${ip}`);

/**
 * Client IP used for the lock. Only headers set by our hosting platform are trusted: on Vercel,
 * `x-vercel-forwarded-for` / `x-real-ip` / `x-forwarded-for` are written by Vercel's edge (a
 * client-supplied value is overwritten). Anywhere else the headers could be forged, so every
 * client shares one bucket and the lock behaves like a per-account lock (never weaker).
 */
export function getTrustedClientIp(req: Request): string {
  if (process.env.VERCEL !== '1') return 'untrusted';
  for (const header of ['x-vercel-forwarded-for', 'x-real-ip', 'x-forwarded-for']) {
    const value = req.headers.get(header)?.split(',')[0].trim();
    if (value) return value;
  }
  return 'unknown';
}

function warn(action: string, err: unknown) {
  // Error names only: messages from the database client can include project details.
  console.warn(`[Login Throttle] Could not ${action}; login continues without this check:`, err instanceof Error ? err.name : 'UnknownError');
}

/** Remaining lock time in ms for this email from this IP, or 0. Fails open (0) with a warning. */
export async function loginLockRemainingMs(email: string, ip: string, firestore: Firestore = db, now = Date.now()): Promise<number> {
  try {
    const snap = await firestore.collection(LOGIN_ATTEMPTS).doc(attemptKey(email, ip)).get();
    const lockedUntil = Number(snap.data()?.lockedUntil || 0);
    return lockedUntil > now ? lockedUntil - now : 0;
  } catch (err) {
    warn('read the login lock', err);
    return 0;
  }
}

/**
 * Counts one failed login for this email from this IP (the lock) and, separately, for the account
 * overall (the monitor). Each counter has its own transaction: heavy contention on the shared
 * account record (an attack from many networks) can make the monitor's transaction fail, and that
 * must never drop the lock counter. Within each transaction, concurrent failures are retried, never
 * lost or double-applied. `accountLabel` is a redacted form of the email for the alert; no password
 * or token is ever logged. The result says which counters were actually saved.
 */
export async function recordLoginFailure(
  email: string,
  ip: string,
  accountLabel: string,
  firestore: Firestore = db,
  now = Date.now()
): Promise<{ attemptRecorded: boolean; accountRecorded: boolean }> {
  const [attemptRecorded, accountRecorded] = await Promise.all([
    recordAttemptFailure(email, ip, firestore, now),
    recordAccountFailure(email, accountLabel, firestore, now),
  ]);
  return { attemptRecorded, accountRecorded };
}

/** The per-email/IP lock counter. Fails open: returns false (with a warning) if it was not saved. */
async function recordAttemptFailure(email: string, ip: string, firestore: Firestore, now: number): Promise<boolean> {
  try {
    const attemptRef = firestore.collection(LOGIN_ATTEMPTS).doc(attemptKey(email, ip));
    await firestore.runTransaction(async (tx) => {
      const attempt = (await tx.get(attemptRef)).data() || {};
      const freshAttempt = now - Number(attempt.windowStart || 0) > WINDOW_MS;
      const failures = (freshAttempt ? 0 : Number(attempt.failures || 0)) + 1;
      const lockedUntil = failures >= LOGIN_MAX_FAILURES ? now + LOCK_MS : Number(attempt.lockedUntil || 0);
      const attemptWindowStart = freshAttempt ? now : Number(attempt.windowStart);
      tx.set(attemptRef, {
        failures,
        windowStart: attemptWindowStart,
        lockedUntil,
        updatedAt: new Date(now).toISOString(),
        expiresAt: new Date(Math.max(attemptWindowStart + WINDOW_MS, lockedUntil)),
      });
    });
    return true;
  } catch (err) {
    warn('record a failed login', err);
    return false;
  }
}

/**
 * The account-wide monitor. Raises the security warning exactly once per window: only the
 * committed transaction that takes the count to ACCOUNT_ALERT_FAILURES logs it.
 */
async function recordAccountFailure(email: string, accountLabel: string, firestore: Firestore, now: number): Promise<boolean> {
  try {
    const accountRef = firestore.collection(LOGIN_ACCOUNT_ACTIVITY).doc(accountKey(email));
    const alert = await firestore.runTransaction(async (tx) => {
      const account = (await tx.get(accountRef)).data() || {};
      const freshAccount = now - Number(account.windowStart || 0) > ACCOUNT_WINDOW_MS;
      const accountFailures = (freshAccount ? 0 : Number(account.failures || 0)) + 1;
      const accountWindowStart = freshAccount ? now : Number(account.windowStart);
      const raiseAlert = accountFailures === ACCOUNT_ALERT_FAILURES;
      tx.set(accountRef, {
        failures: accountFailures,
        windowStart: accountWindowStart,
        alertedAt: raiseAlert ? new Date(now).toISOString() : freshAccount ? null : account.alertedAt ?? null,
        updatedAt: new Date(now).toISOString(),
        expiresAt: new Date(accountWindowStart + ACCOUNT_WINDOW_MS),
      });
      return raiseAlert;
    });

    if (alert) {
      console.warn(
        `[Security Alert] ${ACCOUNT_ALERT_FAILURES} failed logins within one hour for account ${accountLabel} (ref ${accountKey(email).slice(0, 12)}). The account is not locked; check for a password-guessing attack.`
      );
    }
    return true;
  } catch (err) {
    warn('update the account-wide login monitor', err);
    return false;
  }
}

/**
 * After a successful login: clears the lock counter for this email from this IP. The account-wide
 * monitor is kept on purpose, so an attack from other networks stays visible.
 */
export async function clearLoginFailures(email: string, ip: string, firestore: Firestore = db): Promise<void> {
  try {
    await firestore.collection(LOGIN_ATTEMPTS).doc(attemptKey(email, ip)).delete();
  } catch (err) {
    warn('clear failed logins', err);
  }
}
