import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req, { throwOnUnavailable: true });
    if (!user) {
      return NextResponse.json({ user: null });
    }
    return NextResponse.json({ user });
  } catch (error) {
    // e.g. the database is briefly unreachable: not a sign-out, so the client keeps its session.
    console.error('Error fetching current user:', error);
    return NextResponse.json({ user: null, error: 'Session check temporarily unavailable' }, { status: 503 });
  }
}
