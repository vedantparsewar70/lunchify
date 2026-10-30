import { NextResponse } from 'next/server';
import { getSyncVersions } from '@/lib/sync-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const versions = await getSyncVersions();
    return NextResponse.json(versions, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (error) {
    console.error('Error fetching sync versions:', error);
    // Never invent new versions on failure: that would make every open page refetch everything
    // exactly when the database is struggling. Clients simply try again on their next poll.
    return NextResponse.json({ error: 'Sync temporarily unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } });
  }
}
