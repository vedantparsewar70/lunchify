import { NextResponse } from 'next/server';
import { getFirebaseConfigStatus, db } from '@/lib/firebase-admin';
import { publicHealthPayload } from '@/lib/health';

export const dynamic = 'force-dynamic';

export async function GET() {
  const configStatus = getFirebaseConfigStatus();
  let dbConnected = false;
  let dbError: string | null = null;

  if (configStatus.configured) {
    try {
      await db.collection('users').limit(1).get();
      dbConnected = true;
    } catch (err: any) {
      dbError = err?.message || String(err);
    }
  }

  if (!configStatus.configured || !dbConnected) {
    // Details stay in the server logs (Vercel -> Logs); only booleans are public.
    console.error('[Health] Unhealthy', {
      initializationError: configStatus.initError,
      databaseError: dbError,
      environment: configStatus.envStatus,
    });
  }

  const payload = publicHealthPayload({
    configured: configStatus.configured,
    initError: configStatus.initError,
    dbConnected,
    dbError,
  });
  return NextResponse.json(payload, { status: payload.status === 'HEALTHY' ? 200 : 503 });
}
