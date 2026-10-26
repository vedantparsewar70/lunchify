/**
 * Imported first by every test file. Guarantees tests can never reach a real Firebase project
 * or the Cashfree API, even if the shell running them has real credentials set.
 */
for (const key of Object.keys(process.env)) {
  if (key.startsWith('FIREBASE_') || key.startsWith('CASHFREE_') || key === 'GOOGLE_APPLICATION_CREDENTIALS') {
    delete process.env[key];
  }
}
delete process.env.ALLOW_MOCK_PAYMENTS;
delete process.env.NEXT_PUBLIC_APP_URL;
delete process.env.VERCEL_ENV;
delete process.env.VERCEL_URL;
process.env.JWT_SECRET = 'test-only-jwt-secret-with-at-least-32-characters';
(process.env as Record<string, string>).NODE_ENV = 'test';

// Post-commit sync notifications fall back to memory without Firebase credentials; that is expected here.
for (const level of ['error', 'warn'] as const) {
  const original = console[level];
  console[level] = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[Sync]')) return;
    original(...args);
  };
}

globalThis.fetch = (async (input: unknown) => {
  throw new Error(`Network access is disabled in tests (attempted: ${String(input)})`);
}) as typeof fetch;

export {};
