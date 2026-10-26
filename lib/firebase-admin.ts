import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

/**
 * Firebase Admin credentials are read exclusively from environment variables.
 *
 * Option A (recommended): three separate variables
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY   (PEM; literal "\n" sequences are converted to newlines)
 *
 * Option B: the full service-account JSON in a single variable
 *   FIREBASE_SERVICE_ACCOUNT_KEY   (raw JSON or base64-encoded JSON)
 *
 * No credentials are embedded in source and no files are read from disk.
 */

let cachedApp: App | null = null;
let cachedDb: Firestore | null = null;
let initError: Error | null = null;

interface ResolvedCredentials {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

function stripWrappingQuotes(value: string): string {
  let result = value.trim();
  while (
    result.length >= 2 &&
    ((result.startsWith('"') && result.endsWith('"')) ||
      (result.startsWith("'") && result.endsWith("'")))
  ) {
    result = result.slice(1, -1).trim();
  }
  return result;
}

/**
 * Normalizes a PEM private key supplied through an environment variable.
 * Hosting dashboards commonly store the key with literal "\n" escape sequences
 * or wrapping quotes; both are converted back to a valid PEM string.
 */
export function normalizePrivateKey(key: string | undefined): string | undefined {
  if (!key) return undefined;

  const normalized = stripWrappingQuotes(key)
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  if (
    !normalized.includes('-----BEGIN PRIVATE KEY-----') ||
    !normalized.includes('-----END PRIVATE KEY-----')
  ) {
    throw new Error(
      'FIREBASE_PRIVATE_KEY is not a valid PEM private key (missing BEGIN/END PRIVATE KEY markers).'
    );
  }

  return `${normalized}\n`;
}

function parseServiceAccountJson(input: string): any {
  const raw = stripWrappingQuotes(input);

  if (raw.startsWith('{')) {
    return JSON.parse(raw);
  }

  // Base64-encoded JSON
  const decoded = Buffer.from(raw, 'base64').toString('utf8').trim();
  if (decoded.startsWith('{')) {
    return JSON.parse(decoded);
  }

  throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY must contain service-account JSON (raw or base64-encoded).');
}

function resolveCredentials(): ResolvedCredentials | null {
  const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();

  // Option B: full service-account JSON in a single variable
  if (serviceAccountEnv) {
    const parsed = parseServiceAccountJson(serviceAccountEnv);
    const projectId = parsed.project_id || parsed.projectId;
    const clientEmail = parsed.client_email || parsed.clientEmail;
    const privateKey = normalizePrivateKey(parsed.private_key || parsed.privateKey);

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_KEY is missing one of: project_id, client_email, private_key.'
      );
    }
    return { projectId, clientEmail, privateKey };
  }

  // Option A: separate variables
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId && !clientEmail && !rawPrivateKey) {
    return null;
  }

  const missing = [
    !projectId && 'FIREBASE_PROJECT_ID',
    !clientEmail && 'FIREBASE_CLIENT_EMAIL',
    !rawPrivateKey && 'FIREBASE_PRIVATE_KEY',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Missing Firebase environment variable(s): ${missing.join(', ')}`);
  }

  return {
    projectId: projectId!,
    clientEmail: clientEmail!,
    privateKey: normalizePrivateKey(rawPrivateKey)!,
  };
}

export function getFirebaseApp(): App {
  if (cachedApp) return cachedApp;

  const existingApps = getApps();
  if (existingApps.length > 0) {
    cachedApp = existingApps[0];
    return cachedApp;
  }

  let resolved: ResolvedCredentials | null = null;
  try {
    resolved = resolveCredentials();
  } catch (err: any) {
    initError = err instanceof Error ? err : new Error(String(err));
    throw new Error(`Firebase credentials are invalid: ${initError.message}`);
  }

  if (!resolved) {
    initError = new Error('No Firebase credentials configured');
    throw new Error(
      'Firebase credentials not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and ' +
        'FIREBASE_PRIVATE_KEY (or FIREBASE_SERVICE_ACCOUNT_KEY) in the environment.'
    );
  }

  cachedApp = initializeApp({
    credential: cert({
      projectId: resolved.projectId,
      clientEmail: resolved.clientEmail,
      privateKey: resolved.privateKey,
    }),
    projectId: resolved.projectId,
  });
  initError = null;
  return cachedApp;
}

// Lazily-initialized Firestore proxy so importing this module never requires credentials
// (e.g. during `next build`); credentials are only resolved on first database access.
export const db: Firestore = new Proxy({} as Firestore, {
  get(_target, prop) {
    if (!cachedDb) {
      cachedDb = getFirestore(getFirebaseApp());
      try {
        cachedDb.settings({ ignoreUndefinedProperties: true });
      } catch {
        // already initialized or settings locked
      }
    }
    const val = (cachedDb as any)[prop];
    return typeof val === 'function' ? val.bind(cachedDb) : val;
  },
});

export function getFirebaseConfigStatus() {
  let configured = false;
  try {
    getFirebaseApp();
    configured = true;
  } catch {
    configured = false;
  }

  return {
    configured,
    initError: initError?.message || null,
    envStatus: {
      hasServiceAccountKey: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_KEY),
      serviceAccountKeyLength: process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.length || 0,
      hasProjectId: Boolean(process.env.FIREBASE_PROJECT_ID),
      projectId: process.env.FIREBASE_PROJECT_ID || null,
      hasClientEmail: Boolean(process.env.FIREBASE_CLIENT_EMAIL),
      hasPrivateKey: Boolean(process.env.FIREBASE_PRIVATE_KEY),
      hasJwtSecret: Boolean(process.env.JWT_SECRET),
      nodeEnv: process.env.NODE_ENV,
      vercelEnv: process.env.VERCEL_ENV || null,
    },
  };
}

export default getFirebaseApp;
